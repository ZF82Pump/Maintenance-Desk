# Validation record

Prepared September 28, 2026.

- 15 automated checks passed under Node.js 24.
- Browser JavaScript syntax checks passed.
- The shared browser and email planning modules are identical.
- Planning cases checked: recurrence through March 2027, shared-part demand, pack rounding, conservative historical lead times, partial receipts, late POs, receipt-after-demand shortages, inspection overrides, overdue cycles and timezone/daylight-saving boundaries.
- Email endpoint tests used a simulated database and provider. Checked unauthorized requests, absent sender configuration, machine-specific recipients, stable daily job keys and no resend after provider acceptance.
- Controller smoke tests exercised all six views and the optional agent read/navigation tools using a minimal document stub.
- No external messages were sent. No accounts were created or credentials used.

## Not verified in this environment

- Real-browser rendering and interaction. The available managed preview path does not serve this plain static GitHub Pages package.
- Supabase SQL execution, real Auth/RLS permissions and concurrent database transactions. No configured Supabase project or PostgreSQL runtime was available.
- Real Supabase Edge Function deployment, Cron/Vault wiring, sender-domain verification and actual inbox delivery.

These are deployment acceptance checks, not completed work. Keep scheduled email paused until they pass.

## Deployment acceptance checklist

1. Signed-out requests cannot read any maintenance tables.
2. An authenticated nonmember cannot read or write workspace records.
3. Viewers can read but cannot change records; editors cannot change recipients/settings or directly alter on-hand/receipt fields.
4. Two receipt calls with the same request ID add stock once; an excessive receipt fails without changing stock.
5. Component completion with insufficient stock fails without changing the next date or history.
6. A receipt increments on-hand and received quantity together. A completed replacement decrements on-hand and updates the component date together.
7. Sign in and verify all forms, mobile layout, calendar navigation, partial receipt and stock adjustments in a browser.
8. Configure only your own test address, enable the schedule after the target time, and confirm one message is accepted and arrives.
9. Re-run the scheduled function the same day and confirm it does not duplicate the accepted message.
10. Pause a recipient and global delivery; confirm subsequent jobs do not send.
