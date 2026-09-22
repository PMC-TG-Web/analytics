# Procore direct cost bills

## Initial workflow

New bill numbers use the Procore project name followed by a per-project sequence: `Evergreen Project 001`, `Evergreen Project 002`. Daily updates to the same monthly bill keep its number. Long names are shortened to fit QBO's 21-character limit. Existing posted PMCDC bills retain their original numbers. The new sequence starts at 001 independently for each project; unused old reservations are preserved as history.

Existing exact-name project products are reused with their established accounts and tax settings after purchase-account validation. New material products use the general Direct Costs + template; new labor products use Labor +. The negative category offsets remain Direct Costs - and Labor -. Existing QBO products are never edited by setup.

For PO items Procore labels Other/equipment, setup lists the affected descriptions and offers **Use Direct Costs - for these items**. Explicit confirmation is required and saved on each item mapping; labor remains Labor -. No Procore cost types are edited. Automatic source checks back off to a minute when idle; the table refreshes at most once per minute during ingestion and every two minutes when idle.

Current local workflow: expand a project review and choose **Set up project** when the project or product mappings are missing. A unique exact QBO project-name match is selected automatically, with its full parent customer name displayed. Choose manually only when there is no unique match, then use **Set up products**. Saved customer IDs always take precedence. The service reuses compatible existing products, creates missing products from approved templates, applies Flatwork, and saves mappings incrementally for future months. Setup does not create a bill. Review the completed costs and use the separate Create/Update bill button. Close setup to return without applying it. Existing customer assignments cannot be changed in this flow.

Host defaults live at `QBO_1/.runtime/direct-cost-bills/setup-defaults.json`. They were copied from the approved Sadsbury setup: material suffix `.M`, labor suffix `.L`, the existing material/labor templates, PMC Procore Direct Costs vendor, Flatwork, Direct Costs - and Labor - offsets, and no customer on offset lines. Product prefixes always use the current project's own Procore project number. Unknown cost types remain blocked pending an explicit accounting rule.

Open `/accounting/direct-cost-bills`, select the project and calendar month, and
export the reviewed draft. The page and API use the existing
`accounting-project-profitability` permission. Reads use PostgreSQL only.

Current draft version 3 uses the live company Cost Catalog for every material unit cost and labor hourly rate. The configured catalog is **Paradise Masonry** (`454507`) for company `598134325805519`, in `config/qboCostCatalog.json`. PO and estimate prices are never a fallback.

Approved, non-deleted productivity logs supply `quantityUsed`; billing-file records and zero usage are excluded. Company + Procore project + explicit line-item ID (including established aliases) identify PO lines. POs supply descriptions, cost codes, units, and source links only. Catalog items match an explicit catalog item ID when present, otherwise a unique normalized name + cost code with compatible units. Numbered CO prefixes and placement suffixes (SOG/Foundation/Wall/Site) are ignored; sizes remain distinct. Missing/ambiguous matches or nonpositive catalog prices block the bill and retain the item name, PO, and daily-log date in the issue. No price is guessed from a bid or PO.

Timecards supply hours grouped by their original cost code. Catalog LABOR items must use an hourly unit and a positive `unit_labor_cost`. Rate priority is category, then SOG (`03-300-20-10`), then travel (`01-300-10-30`). Multiple valid travel rates use the lowest; other conflicting category/SOG rates remain blocked. No bid-board linkage is needed. Source evidence includes the selected catalog item ID, catalog folder ID, cost code, rate, and timecard IDs. Concrete and pumping exclusions, product/project/class assignments, and category offsets are unchanged.

Catalog ingestion runs through the bill-page controlled sync route while the page is visible. Under the existing shared company worker lease, it checks the catalog at most every five minutes, paginates all items, then atomically saves the complete normalized snapshot to `ProcoreSyncProjectState` (`projectId=__company__`, `dataset=qbo_cost_catalog`, `lastResult`). Failures preserve the previous snapshot; snapshots older than 24 hours block posting. Ordinary preview/queue reads use only PostgreSQL, and a queue calculation shares one snapshot across projects. Source sync timestamps alone do not change the reviewed fingerprint. A changed price requires reopening the review and explicitly updating the same monthly bill.

Deploy the compatible QBO_1 v3 bill builder before the Analytics page. It validates current catalog evidence and retains legacy v1/v2 support for existing drafts/receipts. Updating the software or synchronizing the catalog never posts Bills automatically. Validate with `node --test test/qboCostCatalog.test.mjs test/qboCostCatalogSync.test.mjs test/qboDirectCostLaborRates.test.mjs test/qboDirectCostLabor.test.mjs test/qboBillSourceRefresh.test.mjs`, plus QBO_1's direct-cost-bill and monthly-bill-sync tests.

The same read-only export can be generated from the repository root:

```powershell
node scripts/exportQboDirectCosts.mjs --company PROCORE_COMPANY_ID --project PROCORE_PROJECT_ID --month 2026-09 --out outputs/direct-cost-draft.json
```

The command requires explicit IDs and refuses to overwrite an existing file.
Exports contain internal business data; do not commit them.

## QBO integration machine

Offset configuration uses `mapping.offsets.material` with `accountId` and
`accountName: "Direct Costs -"`, and `mapping.offsets.labor` with the
`Labor -` account. Each target requires `classId` (an explicit ID or `null`
for no class). Set `mapping.offsets.customerAssignment` to `none` or
`same-project`. These choices are mandatory when offsets are configured;
the writer never guesses them. The builder adds negative category-detail
lines equal to the rounded material/labor totals and returns gross costs,
offset total, and a net-zero bill total. Other cost types require a separate
offset rule. Live validation checks the offset accounts and classes as well
as the positive items. Zero-total bill acceptance/reporting still requires
a QBO sandbox check; no production bill has been posted.

The companion implementation is in `../QBO_1/src/`:

- `direct-cost-bill.js`: validates the export and explicit saved mappings;
- `bill-writer.js`: a dedicated, opt-in bill-create client;
- `bill-posting-ledger.js`: durable project/month claims and receipts;
- `post-direct-cost-bill.js`: preview and post command.

The existing general QBO client and Procore read-only restrictions are unchanged.
Analytics holds no QBO credentials and has no browser posting endpoint yet.
This version uses a reviewed file handoff, not a hosted worker/queue.

Copy `QBO_1/docs/direct-cost-bill-mapping.example.json` to a local file under
`QBO_1/.runtime/` and enter actual QBO IDs. Bind it to the QBO environment/realm
and Procore company/project. The vendor must be `PMC Procore Direct Costs`.
Use the QBO project's customer/subcustomer ID that existing QBO transactions
reference, with its exact display name. Validate project profitability
attribution in sandbox before production. Do not infer posting identity from
reporting name matches. Each Procore line needs a purchase-enabled QBO service
or noninventory item and matching unit of measure. Products must use
`<Procore project number>-<Procore cost code>.<suffix>`, for example
`2508 - SC-03-300-20-20.M`. Save both `itemId` and the exact `itemName` in
each mapping; posting verifies that QBO returns that same name for the ID.
The suffix is an explicit mapping choice, not inferred from the broad Materials
cost type. Create missing products using an explicit existing product as the
accounting template; do not fall back to legacy hierarchical items. Optional `classId` assigns
the positive item line's class. Inventory items and non-USD currencies are
not supported in this version.

For missing products, `QBO_1/src/ensure-direct-cost-product.js` performs an exact
name lookup including inactive items, then previews or creates the product:

```powershell
node src/ensure-direct-cost-product.js --project-number "2508 - SC" --name "2508 - SC-03-300-00-20.M" --description "Foundation Concrete Material.Concrete" --template TEMPLATE_ITEM_ID --environment production
```

Add `--apply` to create it. The environment must match the connected integration.
The template supplies service/noninventory type, income/expense accounts, and
tax settings. It does not supply prices or quantities. Existing compatible
products are reused; inactive or conflicting products require review. Creation
attempts are recorded under `.runtime/direct-cost-products/`, and every new
product is read back before returning its ID. Store that ID and exact name in
the project's mapping. Product creation does not enable bill posting.

From the `QBO_1` directory, using the same environment/token storage as the
existing integration:

```powershell
node src/post-direct-cost-bill.js --draft PATH_TO_EXPORT --mapping .runtime/project-mapping.json --date 2026-09-16
```

This writes a proposed QBO payload under `.runtime/direct-cost-bills/` and prints
its fingerprint. Preview makes no QBO requests. Review that file, including the
priced and unpriced timecard hours and the exclusion of category offsets.

To enable a sandbox write, configure `QBO_BILL_WRITES_ENABLED=true`,
`QBO_BILL_ALLOWED_REALM_ID`, and `INTUIT_ENVIRONMENT=sandbox` on the integration
machine, then add `--post --confirm REVIEWED_FINGERPRINT` to the same command.
Posting verifies the live vendor/project/items before creating a bill. Keep
writes disabled until mappings and the intended target are ready. Production
requires the production environment, corresponding connected realm, mapping,
and explicit reviewed post command; nothing here changes those settings.

The ledger key includes environment, realm, Procore company, project, and month.
Bill numbers use `PMCDC001`, `PMCDC002`, and so on (continuing to `PMCDC1000`
after `PMCDC999`). The first valid integration preview reserves a number under
`.runtime/direct-cost-bills/numbers/`; later previews/retries for that same
project/month reuse it. The sequence is shared across projects within a QBO
company/environment. Reservations are not recycled if a draft is abandoned.
Keep this directory with the posting ledger and use the same integration
machine for all operators. A concurrent/stale numbering lock blocks allocation
rather than risking duplicate numbers. Before a new bill is sent, the writer
checks QBO for that exact document number and blocks collisions. Bill numbers
are part of the reviewed fingerprint, so previews made before numbering must
be regenerated. The number is required on every bill payload.

One claim creates one monthly bill. Later reviewed runs replace all item and
offset lines on that same QBO bill with current month-to-date totals. The bill
ID, number, and original transaction date remain stable. Unchanged accounting
contents skip the write, even when the run date changes. A current SyncToken
must match the saved receipt; manual QBO changes and linked transactions block
updates for reconciliation. Full updates use a revision-specific request ID.
A timeout, process crash, or ambiguous QBO response leaves the
claim blocked for reconciliation. Inspect the saved request ID and QBO records;
do not delete claims to retry. Back up and retain `.runtime/direct-cost-bills/`;
all operators must use the same integration machine and ledger directory.

The review page reads sanitized mappings, number reservations, and receipts
from `QBO_INTEGRATION_ROOT` (default sibling `QBO_1`). It displays create/update
intent, item product names, category offsets and last posting time. It never
reads tokens or reserves numbers on GET. Hosts without the integration files
show mappings as unavailable. When the shared bill service is configured, the expanded review offers Create bill / Update bill. Otherwise export and the reviewed integration command remain the handoff.

The page opens with a searchable monthly project table, defaulting to **Needs
attention**. Rows show bill status/number, monthly gross costs, change since the
last saved bill, labor hours, last save time, and a Review action. Status filters
include Not created, Update needed, Up to date, Needs review, Setup/status needed,
and No eligible costs. Differences are detected from individual line quantities,
rates and accounting assignments, including changes with no gross-total change.
Missing mappings or ledger evidence remain visible as unresolved status. Refresh
after source synchronization or a successful integration save. This is a local
ledger comparison; it does not query QBO for manual edits.

## Validation

```powershell
node --test test/qboDirectCosts.test.mjs test/qboDirectCostLabor.test.mjs test/permissions.test.mjs
npx tsc --noEmit
```

In `QBO_1`: `node --test test/direct-cost-bill.test.js test/direct-cost-products.test.js test/client-security.test.js`.
Tests mock QBO writes. Sandbox validation is a separate step and has not been
performed simply by running tests. No schema migration is needed for this
file-handoff version.

Product prefixes come from the synchronized Procore project number, never a shared fixed prefix or the project name. A missing project number blocks the mapping. Existing project products retain their established suffix and accounting setup (Sadsbury concrete uses `.M`, labor `.L`). Missing products require an explicit project number and accounting template when created.

Item-detail class (2026-09-17): all configured Sadsbury material and labor items use Flatwork via each mapping item's classId. Apply the same Flatwork assignment when adding future item mappings. The existing bill builder includes it as ItemBasedExpenseLineDetail.ClassRef and includes class changes in the review fingerprint, so a fresh review is required. Category offsets retain their existing Flatwork class. Verified all nine item lines, unchanged offsets and a zero bill total without posting to QBO.

Automatic source corrections: keep the bill page visible to check monthly projects in turn. Checks start on opening the page, with a 15-second pause between project requests and a shared minimum five-minute interval per project. A busy Procore worker or provider cooldown defers checks automatically. The status message reports checks or failures; the project table and affected expanded review refresh after ingestion. Catalog prices refresh company-wide every five minutes; PO identity corrections still rotate by project. Daily-log changes arrive through their existing sync schedules. QBO bills are saved only through the review's Create/Update button.


Concrete exclusion (2026-09-17): omit material usage under Foundation Concrete 03-300-00-20, Wall Concrete 03-300-10-20, Slab On Grade Concrete 03-300-20-20, and Site Concrete 03-300-30-20. Apply this in the shared database aggregation used by preview, export and POST, before price validation. Preserve labor and other materials. Negative category offsets are calculated from the remaining lines. Existing saved bills change only on a reviewed update; no automatic QBO mutation occurs.


Confirmed deleted-bill recovery (2026-09-17): Sadsbury September PMCDC001 / QBO Bill 87770 was absent from both ID and document-number read-only queries. With the host paused and no pending writes, its ledger directory and original number reservation were preserved under archived-deleted. The old reservation was retired without recycling the number; the project/month now reserves PMCDC002. Creation request IDs include the reserved bill number so an authorized replacement cannot replay the deleted bill's original request. No QBO bill was created during recovery. Future manual deletions still require verified reconciliation; the worklist does not automatically detect them.


Travel rate conflicts (2026-09-18): when cost code 01-300-10-30 has multiple valid positive hourly rates in the current company catalog, use the lowest rate for all applicable hours. Preserve one labor line, its source hours, and only the matching selected-rate evidence. The preview labels Lowest travel rate (or Travel fallback (lowest rate)). Missing/invalid rates retain existing fallback behavior; conflicting SOG and other category rates still require review.


## Resolve catalog mappings from the bill page

Expand a project and use **Cost Catalog mappings → Choose catalog item** beside an unresolved PO line. Search by item name or cost code, review the current cost and unit, then choose **Save mapping & refresh review**. Only compatible-unit items with a positive current cost appear. The choice is remembered for this project's PO line across monthly runs; the rate remains the latest catalog price. **View / change all mappings** also lets operators replace an automatic match or return a saved choice to automatic matching. A changed source identity or a removed/invalid catalog item requires another review. Different catalog/source cost codes are shown explicitly; choosing a catalog price does not reassign the bill's original cost code or QBO product.

Missing QBO products are handled by the **Set up QBO project** panel on this same expanded row. The panel remains visible when a source issue blocks setup and explains what to resolve first. Once catalog/source issues are clear, use **Set up products** to reuse/create the required products, then review and save the bill separately.


Shop Drawings vendor charges are excluded before catalog pricing, product setup, and bill aggregation. Match cost code `01-300-10-40` (including typed suffixes) or the words Shop Drawing/Shop Drawings in the PO description, covering legacy Rebar Shop Drawings Lump Sum charges labeled Labor under travel code `01-300-10-30`. Employee timecard hours remain included. The preview reports excluded Shop Drawings entries. Existing bills reflect this exclusion on the next reviewed Update; unrelated vendor bills and source records are unchanged. Validate with `node --test test/qboDirectCosts.test.mjs test/qboDirectCostLabor.test.mjs`.


### Manual QBO bill reconciliation

The expanded monthly review includes **Reconcile QBO changes** for an existing bill. Its authenticated, same-origin `/api/accounting/direct-cost-bills/reconcile` endpoint rebuilds the database draft and requests `reconcile-preview` or `reconcile-confirm` through the shared host. Preview reads the live bill and shows current versus proposed lines. Confirmation rechecks the source fingerprint, receipt and live bill under the monthly lock, saves a local audit in `posted/<identity>/reconciliations/`, and acknowledges the reviewed SyncToken. It does not write QBO. `reconciliationPending` ensures the subsequent normal **Update bill in QBO** replaces lines even if source totals match the previous successful save. Further QBO changes still block. Deleted bills, uncertain writes, changed bill identity, payments and linked transactions require separate recovery. Normal posting still validates references and the current reviewed monthly draft.

Validation: `node --test test/qboBillReconciliationRoute.test.mjs test/qboBillRelay.test.mjs test/permissions.test.mjs`; in QBO_1, `node --test test/bill-reconciliation.test.js test/monthly-bill-sync.test.js test/direct-cost-bill-service.test.js`.

The **Check QBO bill** action is neutral until a live comparison returns. An unchanged QBO SyncToken displays **No reconciliation needed** with no confirmation control; source-cost, note, and display-name differences alone do not require reconciliation. A changed QBO version enables the reviewed acknowledgment flow. The host rejects unnecessary confirmations without changing the receipt. UI validation: `node --test test/qboBillReconciliationPanel.test.mjs`.

Freeform PO descriptions may use automatic Cost Catalog pricing when no exact name matches: the same cost code, compatible unit and labor/nonlabor kind must have one positive current rate (multiple items at that identical rate are allowed). Explicit catalog IDs and saved choices retain precedence. Different or missing prices still require selection. This fallback is disabled when multiple active monthly PO source lines share the same cost code and normalized description; repeated logs for the same source ID are aggregated normally. The original PO description and identity are preserved, and missing QBO assignments appear as Product mapping needed through the existing setup flow. No catalog item or bill is created by matching. Validate with `node --test test/qboCatalogMapping.test.mjs test/qboCostCatalog.test.mjs test/qboDirectCosts.test.mjs`.

Food / Food Cost PO lines (including numbered CO prefixes) use a bill-only coding override in `qboDirectCostCoding.ts`: cost code `01-300-10-80`, Materials, producing the configured `.M` QBO product under the project prefix and Direct Costs - offsets. The monthly draft and catalog picker use the same coding. Source records, original descriptions, units, quantities and prices are not rewritten. Labor is not reclassified. Current catalog pricing validation still applies. Validate with `node --test test/qboDirectCostCoding.test.mjs test/qboCatalogMapping.test.mjs`.
