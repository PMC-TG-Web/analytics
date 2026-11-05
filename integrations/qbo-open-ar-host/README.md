# Open A/R read-only host operation

Apply `open-ar.patch` to the compatible `QBO_1` host after backing up its affected file:

```powershell
git apply --ignore-space-change --check <absolute-patch-path>
git apply --ignore-space-change <absolute-patch-path>
```

An already installed host passes `git apply --ignore-space-change --reverse --check`.
This patch adds a company-validated `open-ar` operation before the monthly bill
validation and optional abort signals to the existing reader query/report methods.
Other client callers retain their existing behavior. It uses only the read-only reader within the existing serialized
connection lane. Existing billing operations, locks, receipts, and writers are
unchanged. No QBO financial writes are required for installation or verification.

The host runs Node 24 and imports the shared native TypeScript collector from
`ANALYTICS_ROOT/src/lib/loadQboOpenArSource.ts`. `ANALYTICS_ROOT` defaults to
`../analytics` relative to the QBO host's working directory. Use the active
Analytics checkout, not a preserved WIP worktree. The collector and its pure
normalization/filter logic are tested in the Analytics repository, avoiding a
second copy of financial calculations.

Validate the Analytics Open A/R tests and the existing host `node --test` suite.
Restart the **PMC QBO Direct Cost Bill Host** scheduled task only when its relay
and bill batch are idle. Never remove lock files or receipts. Verify the fresh
heartbeat and perform an `open-ar` read through the authenticated relay.

Apply the additive Analytics snapshot migration before refreshing. Release
Analytics through GitHub `main` and Netlify's integration. Refresh from the new
page to save the first snapshot. POST queues the read and returns 202 immediately;
the browser polls the company-scoped refresh ID and imports its completed result.
Leave the page open until completion. Jobs have a five-minute start deadline and
individual QBO reads have a 45-second abort signal. Active jobs are reused on retry.
Ordinary GET and navigation never call QBO.
