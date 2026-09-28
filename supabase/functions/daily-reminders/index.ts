import {forecast,todayIn} from '../_shared/planning.js';
// Cron-only endpoint. No browser access or user-supplied recipients.
const env=(k:string)=>Deno.env.get(k)||'';
const reply=(code:number,value:unknown)=>new Response(JSON.stringify(value),{status:code,headers:{'content-type':'application/json'}});
async function equal(a:string,b:string){const encoder=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(a)),crypto.subtle.digest('SHA-256',encoder.encode(b))]);let mismatch=0;const xx=new Uint8Array(x),yy=new Uint8Array(y);for(let i=0;i<xx.length;i++)mismatch|=xx[i]^yy[i];return mismatch===0;}
async function db(path:string,method='GET',body?:unknown,prefer='return=representation'){
 const r=await fetch(env('SUPABASE_URL')+'/rest/v1/'+path,{method,headers:{apikey:env('SUPABASE_SERVICE_ROLE_KEY'),Authorization:'Bearer '+env('SUPABASE_SERVICE_ROLE_KEY'),'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});
 const text=await r.text();let j;try{j=text?JSON.parse(text):null;}catch{throw Error('Database response could not be read');}if(!r.ok)throw Error(j?.message||'Database request failed');return j;
}
async function all(name:string,filter=''){let out:any[]=[];for(let offset=0;;offset+=500){const rows=await db(`pm_${name}?select=*&order=id&limit=500&offset=${offset}${filter?'&'+filter:''}`);out.push(...rows);if(rows.length<500)return out;}}
export function buildEmail(model:any,data:any,recipient:any,kind:string){
 const components=model.components.filter((c:any)=>!recipient.machine_id||c.machine_id===recipient.machine_id);
 const alerts=model.attention.filter((p:any)=>!recipient.machine_id||p.uses.some((c:any)=>c.machine_id===recipient.machine_id));
 if(kind==='purchasing'&&!alerts.length)return null;
 const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:data.settings.currency}).format(n);
 const overdue=components.filter((c:any)=>c.days<0),soon=components.filter((c:any)=>c.days>=0&&c.days<=30);
 const due=[...components].sort((a:any,b:any)=>a.days-b.days);
 const lines=[`Maintenance desk — ${model.today}`,'',kind==='summary'?`${overdue.length} overdue replacements; ${soon.length} due within 30 days; ${alerts.length} parts need purchasing attention.`:`${alerts.length} parts need purchasing attention.`, ''];
 if(kind==='summary')lines.push('NEXT MAINTENANCE',...due.slice(0,40).map((c:any)=>`${c.machine} / ${c.name} (${c.part?.pn}): ${c.due}, ${c.days<0?-c.days+' days overdue':c.days+' days left'}.`),due.length>40?'More components are listed on the website.':'','');
 lines.push('PURCHASING',...alerts.map((p:any)=>`${p.pn} — ${p.name}\n${p.status}. On hand ${p.on_hand}; open orders ${p.openQty}; reserve ${p.safety_units}.\nSuggested purchase ${p.buy} units (${money(p.estimatedCost)}), order by ${p.orderDate}. Planning lead ${p.lead} calendar days.${p.lateQty?' '+p.lateQty+' units are on late orders: confirm supplier ETA before placing a duplicate order.':''}`));
 if(!alerts.length)lines.push('No purchasing alerts today.');
 lines.push('','Shared-part purchase quantities cover all machines that use the part. Forecasts use your intervals and inspection due dates.',env('APP_URL')?'Open your maintenance desk: '+env('APP_URL'):'','Manage recipients and schedules in Email reminders.');
 return {from:env('EMAIL_FROM'),to:[recipient.email],subject:`${kind==='summary'?'Maintenance summary':'Purchasing attention'} — ${model.today}`,text:lines.join('\n')};
}
Deno.serve(async req=>{
 if(req.method!=='POST')return reply(405,{error:'POST required'});
 if(!env('CRON_SECRET')||!(await equal(req.headers.get('x-cron-secret')||'',env('CRON_SECRET'))))return reply(401,{error:'Unauthorized'});
 if(!env('RESEND_API_KEY')||!env('EMAIL_FROM'))return reply(503,{error:'Email sender is not configured'});
 try{
  const settings=(await db('pm_settings?id=eq.1&select=*'))[0];if(!settings?.enabled)return reply(200,{state:'paused'});
  const now=new Date(),day=todayIn(settings.timezone,now);
  const local=new Intl.DateTimeFormat('en-GB',{timeZone:settings.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  // After the daily target time, retry/check through the end of the local day.
  if(local<settings.morning_time.slice(0,5))return reply(200,{state:'before scheduled time'});
  const [machines,parts,components,orders,recipients]=await Promise.all(['machines','parts','components','orders','recipients'].map(n=>all(n)));
  const data={settings,machines,parts,components,orders},model=forecast(data,day),active=recipients.filter((r:any)=>r.enabled);
  for(const recipient of active)for(const kind of ['summary','purchasing']){
   if(!(kind==='summary'?recipient.digest:recipient.alerts))continue;
   const payload=buildEmail(model,data,recipient,kind);if(!payload)continue;
   // Ignore duplicate keys; an existing day's payload must stay identical for retries.
   await db('pm_mail_jobs?on_conflict=dedupe_key','POST',{dedupe_key:`${day}:${recipient.id}:${kind}`,recipient_id:recipient.id,recipient_email:recipient.email,kind,local_date:day,payload},'resolution=ignore-duplicates,return=minimal');
  }
  const queued=await all('mail_jobs',`local_date=eq.${day}&status=neq.accepted&attempts=lt.3`);
  const pending=queued.filter((j:any)=>active.some((r:any)=>r.id===j.recipient_id&&r.email===j.recipient_email&&(j.kind==='summary'?r.digest:r.alerts))).slice(0,5);
  let accepted=0,failed=0;
  for(const j of pending){
   // Do not send a queued message to a recipient disabled or changed after enqueue.
   const recipient=active.find((r:any)=>r.id===j.recipient_id&&r.email===j.recipient_email&&(j.kind==='summary'?r.digest:r.alerts));
   if(!recipient)continue;
   const claim=(await db('rpc/pm_claim_mail','POST',{p_id:j.id}))[0];if(!claim)continue;
   try{
    await new Promise(resolve=>setTimeout(resolve,600));
    const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env('RESEND_API_KEY'),'Content-Type':'application/json','Idempotency-Key':'maintenance-'+j.id},body:JSON.stringify(claim.payload),signal:AbortSignal.timeout(20000)});
    const result=await res.json();if(!res.ok)throw Error(String(result.message||'Email provider rejected the request').slice(0,300));
    await db(`pm_mail_jobs?id=eq.${j.id}`,'PATCH',{status:'accepted',provider_id:result.id,accepted_at:new Date().toISOString(),lease_until:null,error:null});accepted++;
   }catch(e){failed++;await db(`pm_mail_jobs?id=eq.${j.id}`,'PATCH',{status:'failed',error:String(e.message).slice(0,300),lease_until:new Date(Date.now()+300000).toISOString()});}
  }
  return reply(200,{accepted,failed,checked_at:new Date().toISOString()});
 }catch(e){console.error('Reminder job failed:',e.message);return reply(500,{error:'Reminder job failed. Review the function logs.'});}
});
