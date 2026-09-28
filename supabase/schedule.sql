-- Enable pg_cron and pg_net in Supabase Database > Extensions first.
-- In Supabase Vault, create two secrets (never publish actual values):
-- maintenance_function_url = https://YOUR-PROJECT.supabase.co/functions/v1/daily-reminders
-- maintenance_cron_secret = same random secret as Edge Function CRON_SECRET
-- Run once. If updating, first: select cron.unschedule('maintenance-daily-check');
select cron.schedule('maintenance-daily-check','*/5 * * * *',$job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='maintenance_function_url'),
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='maintenance_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 );
$job$);
