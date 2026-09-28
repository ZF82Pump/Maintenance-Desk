# Maintenance desk

A GitHub Pages website with a shared Supabase database and daily email reminders through Resend. The website needs no build step or Python installation. Open **docs/SETUP.html** for the step-by-step setup guide.

## Included

- Sign-in and administrator/editor/viewer access. One shared workspace per Supabase project.
- Machines, components, inspection overrides and a two-year recurring calendar.
- Shared part inventory, actual lead history, stock adjustments and purchase estimates.
- Purchase orders, partial receipts, and atomic stock consumption when recording maintenance.
- Daily summaries and purchasing alerts, chosen recipients, machine scope, timezone and delivery time.
- Persistent email history, limited retries and duplicate protection.
- Clearly labeled temporary demo workspace. Demo data is never uploaded or emailed.

## Status

This is source code prepared for deployment. It is **not hosted or connected to an email account**. `docs/config.js` is intentionally blank. Real data is saved only after Supabase is configured. Emails stay paused by default.

Planning and mocked email integration checks can run with Node.js 24+: `npm test`. `npm run check` checks browser JavaScript syntax. No npm dependencies are needed for the app. Before deploying the Edge Function after modifying planning rules, run `node sync-planning.js` to keep the browser and server copies identical.

## Setup order

1. Create Supabase project; run `supabase/schema.sql` once.
2. Create administrator Auth user and insert its UUID into `pm_members` with admin role.
3. Fill the two PUBLIC connection values in `docs/config.js`.
4. Upload the project to GitHub. Enable Pages from the main branch, `/docs` folder.
5. Verify a sender domain in Resend and deploy `supabase/functions/daily-reminders` with the private secrets described in the guide.
6. Create the Vault secrets, enable Cron, run `supabase/schedule.sql` once.
7. Sign in, add records and a test recipient, verify preview, then enable reminders.

## Rules and limits

- Dates and intervals use calendar days. This is interval/inspection-based maintenance planning, not sensor-based failure prediction.
- Recurring demand is forecast over 730 days. Large existing stocks can push the first need beyond the horizon.
- Planning lead = max(current quote, longest fully received noncancelled historical order) + buffer.
- Inventory is simulated by calendar date. Expected receipts apply before replacements that day; late unreceived orders are excluded and flagged.
- Future cycles after an overdue component assume its pending replacement is completed today. Actual completion resets the schedule.
- Safety stock is a reserve floor. Suggested buying covers the largest shortfall in the purchase window and is rounded to pack size.
- Costs use one workspace currency and exclude freight/tax. There is no currency conversion.
- Component completion and receipts update stock atomically. Stock changes have a history and request IDs prevent duplicate application of retried actions.
- New historical orders start unreceived. Receiving them adds stock: reconcile opening stock to avoid double counting. Actual lead is based on the final receipt date.
- Emails are checked every five minutes after the scheduled local time. This is not a guaranteed delivery SLA. Cron/function failures must be monitored.
- Each recipient gets at most one queued summary and one purchasing email per local date. A queue entry is a snapshot; it is not rebuilt during retries. New alerts arising later in the day are picked up by subsequent checks if no purchasing email was already queued for that day.
- Resend acceptance is recorded, not inbox delivery. After three attempts, failed jobs remain visible for operator review. Automatic retries are limited to the current local date and jobs less than 23 hours old.
- Resend credentials, cron secret and service-role key belong only in server secrets, never in GitHub or the browser.
- No Excel import/export, attachments, password-reset UI, multi-company tenancy or automatic provider delivery webhooks are included in this version. Users can be created/reset by the Supabase administrator.
- Frontend source may be public on GitHub Pages. Database records require an authenticated allowlisted member. Public signup must remain disabled.

## Validation performed

See `VALIDATION.md`. Live Supabase deployment, database policies against real Auth sessions, domain verification, live email delivery and browser visual QA still require the configured services and browser environment.

## References

- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/functions/function-configuration
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/api-reference/errors
