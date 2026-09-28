// Shared, dependency-free planning engine. Dates are calendar dates, not elapsed hours.
export const DAY=86400000;
export const dateNum=s=>Math.floor(Date.parse(s+'T00:00:00Z')/DAY);
export const dateStr=n=>new Date(n*DAY).toISOString().slice(0,10);
export const addDays=(s,n)=>dateStr(dateNum(s)+n);
export function todayIn(zone='America/New_York',now=new Date()){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const v=t=>p.find(x=>x.type===t).value;return `${v('year')}-${v('month')}-${v('day')}`;
}
export function forecast(data,today=todayIn(data.settings?.timezone),days=730){
 const start=dateNum(today),end=start+days;const machines=new Map(data.machines.map(x=>[x.id,x]));
 const parts=new Map(data.parts.map(x=>[x.id,x]));const events=[];
 const components=data.components.filter(c=>c.active!==false).map(c=>{
  const due=c.inspection_due||addDays(c.last_replaced,c.interval_days);
  const base={...c,due,days:dateNum(due)-start,machine:machines.get(c.machine_id)?.name||'Unknown machine',part:parts.get(c.part_id)};
  events.push({...base,date:due,type:'replace',projected:false});
  // One outstanding replacement is carried overdue; future cycles assume it is done today.
  for(let n=Math.max(start,dateNum(due))+c.interval_days;n<=end;n+=c.interval_days){events.push({...base,date:dateStr(n),type:'replace',projected:true});}
  return base;
 });
 const plans=data.parts.map(p=>{
  const uses=components.filter(c=>c.part_id===p.id),po=data.orders.filter(o=>o.part_id===p.id&&!o.cancelled);
  const completed=po.filter(o=>o.received_qty>=o.quantity&&o.received_date);
  const actual=completed.map(o=>dateNum(o.received_date)-dateNum(o.ordered_date));
  const maxActual=actual.length?Math.max(...actual):null,avgActual=actual.length?actual.reduce((a,b)=>a+b,0)/actual.length:null;
  const lead=Math.max(p.claimed_lead_days,maxActual??0)+p.buffer_days;
  const open=po.filter(o=>o.received_qty<o.quantity);
  const late=open.filter(o=>dateNum(o.expected_date)<start);
  const incoming=open.filter(o=>dateNum(o.expected_date)>=start);
  const needs=events.filter(e=>e.part_id===p.id&&dateNum(e.date)<=end);
  const daily=new Map();
  for(const e of needs){const n=Math.max(start,dateNum(e.date));daily.set(n,(daily.get(n)||0)+e.quantity);}
  const arrivals=new Map();for(const o of incoming){const n=dateNum(o.expected_date);arrivals.set(n,(arrivals.get(n)||0)+o.quantity-o.received_qty);}
  let balance=p.on_hand,shortage=balance<p.safety_units?start:null;
  for(let n=start;n<=end&&shortage===null;n++){balance+=(arrivals.get(n)||0)-(daily.get(n)||0);if(balance<p.safety_units||balance<0)shortage=n;}
  const orderDay=shortage===null?null:shortage-lead;
  const horizon=Math.min(end,Math.max(start,orderDay??start)+lead+p.review_days);
  const demand=[...daily].filter(([n])=>n<=horizon).reduce((s,[,q])=>s+q,0);
  const timely=incoming.filter(o=>dateNum(o.expected_date)<=horizon).reduce((s,o)=>s+o.quantity-o.received_qty,0);
  const target=demand+p.safety_units;
  // A receipt arriving after demand must not erase the intervening shortage.
  let projected=p.on_hand,minimum=projected;
  for(let n=start;n<=horizon;n++){projected+=(arrivals.get(n)||0)-(daily.get(n)||0);minimum=Math.min(minimum,projected);}
  const buy=shortage===null?0:Math.ceil(Math.max(0,target-p.on_hand-timely,p.safety_units-minimum)/p.pack_size)*p.pack_size;
  let status=!uses.length?'No schedule':orderDay===null?'Covered':orderDay<=start?'Order now':orderDay<=start+30?'Due soon':'Planned';
  if(late.length&&orderDay!==null&&orderDay<=start)status='Check late PO';
  const r={...p,lead,maxActual,avgActual,receivedOrders:completed.length,openQty:open.reduce((s,o)=>s+o.quantity-o.received_qty,0),lateQty:late.reduce((s,o)=>s+o.quantity-o.received_qty,0),target,buy,estimatedCost:buy*p.unit_cost,orderDate:orderDay===null?null:dateStr(orderDay),shortageDate:shortage===null?null:dateStr(shortage),status,uses};
  if(orderDay!==null&&buy>0&&uses.length)events.push({id:'order-'+p.id,part_id:p.id,name:p.name,machine:'Shared parts stock',date:r.orderDate,type:'order',quantity:buy,projected:false,part:p});
  return r;
 });
 return {today,components,parts:plans,events:events.sort((a,b)=>a.date.localeCompare(b.date)),overdue:components.filter(c=>c.days<0),soon:components.filter(c=>c.days>=0&&c.days<=30),attention:plans.filter(p=>p.status==='Order now'||p.status==='Check late PO')};
}
