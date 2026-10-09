# QBO host: closed-month pricing

The bill writer runs in the separate `QBO_1` directory, outside this Git repository. `closed-month-pricing.patch` versions the host implementation and regression tests alongside the Analytics release. It contains source code only, never runtime mappings, receipts, credentials or production payloads.

Apply to a compatible host checkout with `git apply --check <absolute-patch-path>`, then `git apply <absolute-patch-path>`. Git apply works outside a Git repository. Back up the affected source/test files first. If the check fails, integrate the changes with the host's newer implementation; do not overwrite it. An already updated host passes `git apply --reverse --check` instead.

Run `node --test` in `QBO_1`. Restart its existing **PMC QBO Direct Cost Bill Host** scheduled task only when no relay job or bill batch is processing. Never clear monthly bill locks, pending journals, or receipts to deploy this code. Verify a fresh relay heartbeat and a read-only `status` request. Do not create or update QBO bills as deployment verification.

The host freezes existing source-line unit rates for months before the current Eastern calendar month. Its baseline is the receipt-matched successful attempt/revision, including output grouping and retained QBO rates. Source keys establish identity; product names do not. Manual additions are excluded using saved QBO line IDs. Existing manual QBO price/class handling is preserved. Food totals, new source lines, and quantity changes remain reviewable. First-time historical bills use current rates because no saved bill price exists. Missing or ambiguous history blocks repricing. Existing source, catalog evidence and freshness validation remain in force.

Deploy this host before the matching Analytics UI. No database migration, historical receipt backfill, automatic bill rewrite or new scheduled batch is required.
