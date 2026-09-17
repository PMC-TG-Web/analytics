# Shared direct-cost bill service

## Installed on this computer

The selected setup uses an **outbound database relay**, not a public HTTP tunnel.
Windows Task Scheduler runs `PMC QBO Direct Cost Bill Host` under ToddGilmore's
signed-in Windows account, using the existing project-local Node 24 runtime.
It starts at sign-in, retries every minute if stopped, and ignores overlapping
runs. No incoming firewall/router port is opened. The computer must remain on
and the account signed in; locking the screen is fine.

`QBO_BILL_RELAY_ENABLED=true` on Analytics selects this transport. The primary
host reads the app's existing database connection from `ANALYTICS_ROOT/.env` and
polls `QboBillRelayJob`; OAuth credentials stay on this computer. A heartbeat in
`QboBillRelayHost` prevents queuing requests while the host is offline. The
additive migration `20260916180000_qbo_bill_relay` creates only these transport
tables and has been applied to the verified Analytics database. No bill records
or profitability snapshots were changed by the migration.

The host handles each job once. Expired unstarted requests are cancelled;
processing requests are never automatically replayed after a disconnect.
The existing local bill ledger remains authoritative for QBO identities,
numbers, receipts and uncertain attempts. A fresh review reveals a late result.
The `service.lock` owner PID prevents a second host process; only a confirmed
dead process lock is reclaimed automatically, never a bill attempt.

Install/restart using `scripts/install-direct-cost-bill-host.ps1` in QBO_1.
Logs: `QBO_1/logs/direct-cost-bill-host.log`. The two additional client machines
are deferred. The optional HTTPS transport below remains available for a future
hosting arrangement but is not used by this installation.

All operators use the same deployed Analytics page from their own browser and
sign in with accounting access. Only one integration host connects to QBO.
Never install independent writable copies with separate bill ledgers on the
three client machines.

## Integration host

Use either the existing Windows integration computer (available while that
computer is on) or a dedicated always-on server with persistent storage.
Run the service from the `QBO_1` directory under the same Windows identity that
owns its encrypted OAuth connection. Moving to another machine requires QBO
reauthorization or a deliberate encrypted-key migration; the existing DPAPI key
cannot simply be copied into another user's account.

Keep `.runtime/direct-cost-bills/`, `.runtime/direct-cost-products/`, mapping
files, number reservations, and receipts together on persistent storage. Back
them up. Do not run two hosts with copies of the same ledger.

Configure these environment variables on the integration host:

- `INTUIT_ENVIRONMENT`: the explicitly selected QBO environment.
- `QBO_BILL_ALLOWED_REALM_ID`: the connected QBO company.
- `PROCORE_COMPANY_ID`: the authorized Procore company.
- `QBO_BILL_BRIDGE_SECRET`: a strong random secret of at least 32 characters.
- `QBO_BILL_BRIDGE_PORT`: optional loopback port, default `4318`.
- `QBO_BILL_WRITES_ENABLED`: keep `false` for setup/read checks; enable `true`
  when ready for operators to submit reviewed bills.

Run `npm run serve:direct-cost-bills`. The HTTP listener binds only to
`127.0.0.1`. Publish `/direct-cost-bills` through a private HTTPS reverse proxy
or authenticated tunnel reachable by the Analytics server. Preserve the
Authorization header, disable caching, and permit the service's request duration.
The service authenticates every request itself; browser CORS access is not needed.
Install it as a supervised service on the chosen host for unattended operation.

The process creates `service.lock`. A normal shutdown releases it. After a crash,
verify no prior process is running and reconcile pending ledger entries before
removing a stale lock. Do not delete bill attempt/receipt files to retry a write.

## Analytics host

Set server-side `QBO_BILL_BRIDGE_URL` to the complete HTTPS endpoint ending in
`/direct-cost-bills`, and `QBO_BILL_BRIDGE_SECRET` to the matching secret. These
are never public/`NEXT_PUBLIC` variables. Local development alone permits an
HTTP loopback endpoint. Production requires HTTPS and does not follow redirects.

Deploy the reviewed application changes. No database migration is needed.
The same deployment and endpoint serve every client machine. If the bridge is
unavailable, display unresolved status and disable posting; never silently use
another local ledger. The current implementation does not queue writes while
the service is offline.

## Operator workflow

1. Open the monthly project table and expand a project.
2. Review quantities, rates, QBO products, offsets, and the reserved bill number.
3. Click Create bill or Update bill. Source values are reloaded on the server;
   any cost/mapping change since the review requires a fresh review.
4. The shared service saves the bill and updates the common ledger. All machines
   see the result after Refresh status. Concurrent unchanged requests reuse the
   successful receipt instead of creating another bill.

An uncertain response disables direct retry. Refresh the project review first;
pending/uncertain QBO attempts remain blocked for reconciliation. Manual QBO
changes are checked through SyncToken before updates.

## Verification

App: `node --test test/qboBillBridge.test.mjs test/qboBillReview.test.mjs test/permissions.test.mjs`

Integration: `node --test test/direct-cost-bill-service.test.js test/monthly-bill-sync.test.js test/direct-cost-bill.test.js`

The service test simulates three simultaneous machines, a single create/number,
subsequent update, and stale-review rejection. These tests mock QBO writes;
they do not post a live bill or prove a host has been deployed.

## Production activation — 2026-09-16

Published deploy: 6aaae6b74610c04ccac9024c at https://analyticspmc.netlify.app/accounting/direct-cost-bills. Verified the live page redirects unauthenticated visitors to /login and the API returns 401. The scheduled host is running with writes enabled; a real September Sadsbury prepare returned PMCDC001, nine lines, gross 8915.54 and no blockers. No live Bill was posted during activation.

Windows release packaging requires an explicit build base so Netlify includes its internal server function. For a prebuilt upload use .netlify/static, not the restored .next directory. Confirm all 11 functions and middleware are included; build without running the repository's broad migration command. The Next.js middleware entry point is src/middleware.ts, forwarding to the existing root policy.

