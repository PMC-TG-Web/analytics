# Analytics Production Data Load

This site should treat Postgres as the app-facing source of truth. The analytics page must read local tables only; Procore API calls belong in controlled sync workers.

## Data Sources

- Projects: `pmc_projects` and `pmc_bid_board_projects`
- Budget plan: `budgetlineitems`
- Field hours: `TimecardEntry`
- Field material/production quantity: `ProductivityLog`
- Purchase order line details: `PurchaseOrderLineItemContractDetail`, used to resolve productivity logs to cost codes

## Required Environment

Production needs these variables configured in the hosting environment, not only in `.env.local`:

- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `APP_BASE_URL`
- `PROCORE_CLIENT_ID`
- `PROCORE_CLIENT_SECRET`
- `PROCORE_COMPANY_ID`
- `PROCORE_API_URL`
- `PROCORE_TOKEN_URL`
- `PROCORE_SYNC_SECRET`
- `CRON_SECRET`
- `PROCORE_WEBHOOK_SHARED_SECRET`, if webhook processing is enabled

Keep `PROCORE_LIVE_API_ENABLED` unset or `false` for normal production traffic. Secret-authenticated sync workers bypass that page-traffic gate.

## Initial Bootstrap

Run the broad sync from a controlled maintenance window. Use the deployed Netlify background function or the Next cron route, authenticated by `CRON_SECRET`.

```bash
curl -X POST "https://analyticspmc.netlify.app/.netlify/functions/procore-sync-background" \
  -H "content-type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"companyId":"598134325805519","maxProjects":0,"lookbackDays":120}'
```

`maxProjects: 0` means no project cap. `lookbackDays` is capped at 120 in the shared cron runner to keep recurring syncs bounded.

For field history older than 120 days, run timecards and productivity as explicit backfill batches by project/date range:

```bash
curl -X POST "https://analyticspmc.netlify.app/api/procore/sync/timecard-entries" \
  -H "content-type: application/json" \
  -H "x-sync-secret: $PROCORE_SYNC_SECRET" \
  -d '{"companyId":"598134325805519","projectIds":["PROJECT_ID"],"startDate":"2025-08-01","endDate":"2026-07-07","perPage":50,"concurrency":1}'

curl -X POST "https://analyticspmc.netlify.app/api/procore/sync/productivity-projects" \
  -H "content-type: application/json" \
  -H "x-sync-secret: $PROCORE_SYNC_SECRET" \
  -d '{"companyId":"598134325805519","projectIds":["PROJECT_ID"],"startDate":"2025-08-01","endDate":"2026-07-07","perPage":50,"concurrency":1,"persist":true}'
```

Prefer project batches over one huge historical run. Keep concurrency low in production.

## Steady State

Use two refresh lanes:

- Webhook lane: `netlify/functions/scheduled-sync.mts` drains queued Procore webhook events every 15 minutes.
- Actuals polling lane: `netlify/functions/scheduled-actuals-sync.mts` runs at minutes 7/22/37/52 and calls `/api/cron/actuals`.
  - This is required for field actuals because the current Procore webhook resource catalog exposes project events, but not timecard entries or productivity logs.
  - The actuals route refreshes purchase-order line item details before productivity logs so productivity quantities can be joined back to budget cost codes.
  - The route rotates through budgeted projects in small batches. Defaults: `PROCORE_ACTUALS_SYNC_PROJECT_BATCH_SIZE=1`, `PROCORE_ACTUALS_SYNC_LOOKBACK_DAYS=45`, `PROCORE_ACTUALS_SYNC_PER_PAGE=100`.
  - For an immediate project-specific refresh:
    ```bash
    curl -X POST "https://analyticspmc.netlify.app/api/cron/actuals" \
      -H "Content-Type: application/json" \
      -H "x-sync-secret: $PROCORE_SYNC_SECRET" \
      -d '{"projectIds":["598134326660487"],"startDate":"2025-08-01","endDate":"2026-07-09"}'
    ```
- Broad polling lane: run `procore-sync-background` manually from a maintenance window for a full bootstrap or larger rolling 30-120 day window.

A normal polling payload:

```json
{
  "companyId": "598134325805519",
  "maxProjects": 0,
  "lookbackDays": 30
}
```

Budget line items and project identity are upserted on every polling run. Timecards and productivity logs should use a rolling lookback so late edits are picked up without hammering Procore.

## Validation

After every bootstrap or scheduled run:

1. Check `/api/cron/sync/logs?limit=10`.
2. Open `/analytics` and confirm diagnostics show non-zero counts for projects, budget lines, timecards, and productivity logs.
3. Spot-check several projects where budget units should match timecard hours or productivity quantity.
4. Investigate sync responses with `207` or failed steps before trusting analytics output.

## Production Rules

- Do not use browser page loads to sync Procore data.
- Do not depend on a user OAuth session for production refreshes.
- Use client credentials plus `PROCORE_SYNC_SECRET` for ingestion.
- Keep sync jobs idempotent and batch-friendly.
- Keep analytics read-only against local tables.
- Treat deletes carefully; current syncs upsert data and are safer than destructive refreshes.
