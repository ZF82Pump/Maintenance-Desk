-- Run once in a NEW or backed-up Supabase project. Single shared maintenance workspace.
begin;
create table public.pm_members(user_id uuid primary key references auth.users(id) on delete cascade,role text not null check(role in ('admin','editor','viewer')),created_at timestamptz not null default now());
create function public.pm_role() returns text language sql stable security definer set search_path='' as $$ select role from public.pm_members where user_id=auth.uid() $$;
revoke all on function public.pm_role() from public;grant execute on function public.pm_role() to authenticated;
create table public.pm_machines(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))>0),location text,notes text,created_at timestamptz not null default now());
create table public.pm_parts(id uuid primary key default gen_random_uuid(),pn text not null unique check(length(trim(pn))>0),name text not null check(length(trim(name))>0),supplier text,unit_cost numeric(12,2) not null default 0 check(unit_cost>=0),claimed_lead_days integer not null default 14 check(claimed_lead_days between 0 and 365),buffer_days integer not null default 7 check(buffer_days between 0 and 365),safety_units integer not null default 1 check(safety_units>=0),review_days integer not null default 30 check(review_days between 0 and 365),pack_size integer not null default 1 check(pack_size>0),on_hand integer not null default 0 check(on_hand>=0),created_at timestamptz not null default now(),check(claimed_lead_days+buffer_days+review_days<=730));
create table public.pm_components(id uuid primary key default gen_random_uuid(),machine_id uuid not null references public.pm_machines,part_id uuid not null references public.pm_parts,name text not null check(length(trim(name))>0),quantity integer not null check(quantity>0),interval_days integer not null check(interval_days between 1 and 3650),last_replaced date not null,inspection_due date,condition text,owner text,active boolean not null default true,created_at timestamptz not null default now());
create table public.pm_orders(id uuid primary key default gen_random_uuid(),po_number text not null unique check(length(trim(po_number))>0),part_id uuid not null references public.pm_parts,ordered_date date not null,quantity integer not null check(quantity>0),unit_cost numeric(12,2) not null check(unit_cost>=0),claimed_lead_days integer not null check(claimed_lead_days>=0),expected_date date not null,received_qty integer not null default 0 check(received_qty>=0),received_date date,cancelled boolean not null default false,created_at timestamptz not null default now(),check(received_qty<=quantity),check(received_qty=0 or received_date is not null),check(received_date is null or received_date>=ordered_date),check(expected_date>=ordered_date));
create table public.pm_service_events(id uuid primary key default gen_random_uuid(),request_id uuid not null unique,component_id uuid not null references public.pm_components,completed_date date not null,quantity integer not null check(quantity>0),notes text,actor uuid references auth.users,created_at timestamptz not null default now());
create table public.pm_stock_moves(id uuid primary key default gen_random_uuid(),request_id uuid not null unique,part_id uuid not null references public.pm_parts,delta integer not null,reason text not null,actor uuid references auth.users,created_at timestamptz not null default now());
create table public.pm_settings(id integer primary key default 1 check(id=1),enabled boolean not null default false,morning_time time not null default '07:00',timezone text not null default 'America/New_York' check(timezone in ('America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Etc/UTC')),currency text not null default 'USD' check(currency in ('USD','CAD','EUR','GBP')));
insert into public.pm_settings default values;
create table public.pm_recipients(id uuid primary key default gen_random_uuid(),name text not null,email text not null unique check(email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),machine_id uuid references public.pm_machines,digest boolean not null default true,alerts boolean not null default true,enabled boolean not null default true,created_at timestamptz not null default now());
create table public.pm_mail_jobs(id uuid primary key default gen_random_uuid(),dedupe_key text not null unique,recipient_id uuid references public.pm_recipients,recipient_email text not null,kind text not null check(kind in ('summary','purchasing')),local_date date not null,payload jsonb not null,status text not null default 'pending' check(status in ('pending','processing','accepted','failed')),attempts integer not null default 0,lease_until timestamptz,provider_id text,error text,created_at timestamptz not null default now(),accepted_at timestamptz);
create index on public.pm_components(part_id);create index on public.pm_components(machine_id);create index on public.pm_orders(part_id);create index on public.pm_mail_jobs(local_date,status);

-- No anonymous access. Membership is managed by the project owner, not by public signup.
alter table public.pm_members enable row level security;
create policy self_membership on public.pm_members for select to authenticated using(user_id=auth.uid());
grant select on public.pm_members to authenticated;
revoke all on public.pm_members from anon;
do $$ declare t text;begin
 foreach t in array array['pm_machines','pm_parts','pm_components','pm_orders','pm_service_events','pm_stock_moves','pm_settings','pm_recipients','pm_mail_jobs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy member_read on public.%I for select to authenticated using(public.pm_role() is not null)',t);
 end loop;
 foreach t in array array['pm_machines','pm_parts','pm_components','pm_orders'] loop
  execute format('grant insert,update on public.%I to authenticated',t);
  execute format('create policy editor_insert on public.%I for insert to authenticated with check(public.pm_role() in (''admin'',''editor''))',t);
  execute format('create policy editor_update on public.%I for update to authenticated using(public.pm_role() in (''admin'',''editor'')) with check(public.pm_role() in (''admin'',''editor''))',t);
 end loop;
 foreach t in array array['pm_recipients','pm_settings'] loop
  execute format('grant insert,update on public.%I to authenticated',t);
  execute format('create policy admin_write on public.%I for all to authenticated using(public.pm_role()=''admin'') with check(public.pm_role()=''admin'')',t);
 end loop;
end $$;
drop policy member_read on public.pm_recipients;
create policy admin_read on public.pm_recipients for select to authenticated using(public.pm_role()='admin');
drop policy member_read on public.pm_mail_jobs;
create policy admin_read on public.pm_mail_jobs for select to authenticated using(public.pm_role()='admin');
-- Stock and receipt fields only change through atomic functions below.
revoke update on public.pm_parts from authenticated;
grant update(pn,name,supplier,unit_cost,claimed_lead_days,buffer_days,safety_units,review_days,pack_size) on public.pm_parts to authenticated;
revoke update on public.pm_orders from authenticated;
grant update(po_number,ordered_date,quantity,unit_cost,claimed_lead_days,expected_date,cancelled) on public.pm_orders to authenticated;
-- Prevent inserting fabricated receipts without a stock movement.
create function public.pm_guard_order_insert() returns trigger language plpgsql set search_path='' as $$ begin if new.received_qty<>0 or new.received_date is not null then raise exception 'Create an open order, then record receipt using Receive';end if;return new;end $$;
create trigger pm_order_insert_guard before insert on public.pm_orders for each row execute function public.pm_guard_order_insert();

create function public.pm_adjust_stock(p_id uuid,p_delta integer,p_notes text,p_request uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(public.pm_role(),'') not in ('admin','editor') then raise exception 'Not authorized';end if;
 if p_notes is null or length(trim(p_notes))=0 then raise exception 'A stock adjustment reason is required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 if exists(select 1 from public.pm_stock_moves where request_id=p_request) then return;end if;
 update public.pm_parts set on_hand=on_hand+p_delta where id=p_id and on_hand+p_delta>=0;
 if not found then raise exception 'Part not found or insufficient stock';end if;
 insert into public.pm_stock_moves(request_id,part_id,delta,reason,actor) values(p_request,p_id,p_delta,p_notes,auth.uid());
end $$;
create function public.pm_receive_order(p_id uuid,p_quantity integer,p_date date,p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.pm_orders;begin
 if coalesce(public.pm_role(),'') not in ('admin','editor') then raise exception 'Not authorized';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 if exists(select 1 from public.pm_stock_moves where request_id=p_request) then return;end if;
 select * into o from public.pm_orders where id=p_id for update;
 if not found or o.cancelled or p_quantity<=0 or p_quantity>o.quantity-o.received_qty or p_date<o.ordered_date or p_date>(now() at time zone (select timezone from public.pm_settings where id=1))::date then raise exception 'Invalid receipt quantity or date';end if;
 update public.pm_orders set received_qty=received_qty+p_quantity,received_date=p_date where id=p_id;
 update public.pm_parts set on_hand=on_hand+p_quantity where id=o.part_id;
 insert into public.pm_stock_moves(request_id,part_id,delta,reason,actor) values(p_request,o.part_id,p_quantity,'Receipt: '||o.po_number,auth.uid());
end $$;
create function public.pm_complete_component(p_id uuid,p_date date,p_notes text,p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.pm_components;begin
 if coalesce(public.pm_role(),'') not in ('admin','editor') then raise exception 'Not authorized';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 if exists(select 1 from public.pm_service_events where request_id=p_request) then return;end if;
 select * into c from public.pm_components where id=p_id for update;
 if not found or not c.active or p_date<c.last_replaced or p_date>(now() at time zone (select timezone from public.pm_settings where id=1))::date then raise exception 'Invalid component or completion date';end if;
 update public.pm_parts set on_hand=on_hand-c.quantity where id=c.part_id and on_hand>=c.quantity;
 if not found then raise exception 'Not enough stock. Record receipt or adjustment first';end if;
 update public.pm_components set last_replaced=p_date,inspection_due=null where id=p_id;
 insert into public.pm_service_events(request_id,component_id,completed_date,quantity,notes,actor) values(p_request,p_id,p_date,c.quantity,p_notes,auth.uid());
 insert into public.pm_stock_moves(request_id,part_id,delta,reason,actor) values(p_request,c.part_id,-c.quantity,'Replacement: '||c.name,auth.uid());
end $$;
revoke all on function public.pm_adjust_stock(uuid,integer,text,uuid),public.pm_receive_order(uuid,integer,date,uuid),public.pm_complete_component(uuid,date,text,uuid) from public;
grant execute on function public.pm_adjust_stock(uuid,integer,text,uuid),public.pm_receive_order(uuid,integer,date,uuid),public.pm_complete_component(uuid,date,text,uuid) to authenticated;

-- Atomic mail claim. Persistent payload + provider idempotency key make retries safe.
create function public.pm_claim_mail(p_id uuid) returns setof public.pm_mail_jobs language sql security definer set search_path='' as $$
 update public.pm_mail_jobs set status='processing',attempts=attempts+1,lease_until=now()+interval '5 minutes'
 where id=p_id and status<>'accepted' and attempts<3 and created_at>now()-interval '23 hours' and (lease_until is null or lease_until<now()) returning *;
$$;
revoke all on function public.pm_claim_mail(uuid) from public,anon,authenticated;
grant execute on function public.pm_claim_mail(uuid) to service_role;
grant all on public.pm_members,public.pm_machines,public.pm_parts,public.pm_components,public.pm_orders,public.pm_service_events,public.pm_stock_moves,public.pm_settings,public.pm_recipients,public.pm_mail_jobs to service_role;
commit;

-- After creating an Auth user in your Supabase dashboard, grant access with:
-- insert into public.pm_members(user_id,role) values('AUTH-USER-UUID','admin');
-- Other roles: editor (records), viewer (read only). Disable public signups.
