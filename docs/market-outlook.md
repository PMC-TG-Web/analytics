# Market Outlook public feeds

October 15, 2026 release: live public-data ingestion and historical WIP/KPI reporting, published through the existing GitHub/Netlify integration after the owner's authorization.

The `/market-outlook` page reads saved PostgreSQL observations. External requests happen only in the controlled sync job or CLI. The source catalog (`src/lib/marketSeries.ts`) specifies exact series IDs, geography, units, frequency, and release-age thresholds. Publisher revisions replace the same period; older history remains available. No Procore or QuickBooks data is changed.

## Configuration

- `FRED_API_KEY`: Census nonresidential spending, effective federal funds rate, and the SLOOS commercial/industrial lending-standard series. Register at https://fred.stlouisfed.org/docs/api/api_key.html.
- `EIA_API_KEY`: Central Atlantic weekly on-highway diesel. Register at https://www.eia.gov/opendata/register.php.
- `BLS_API_KEY`: optional. Seven series are fetched in one request, using the unregistered API limit until configured. Registration at https://www.bls.gov/developers/.
- `MARKET_DATABASE_URL`: optional isolated local preview database. Without it, the shared Prisma database is used. This override is server-only.
- `MARKET_SYNC_ENABLED=true`: enables the HTTP worker and Netlify daily schedule.
- `PROCORE_SYNC_SECRET` and `APP_BASE_URL`: existing scheduler authentication and origin configuration. The worker accepts `x-sync-secret` only and rejects missing/incorrect secrets before database access.

Store credentials in the local environment or Netlify Functions environment; never in source, browser configuration, screenshots, or committed evidence. Both keyed providers are configured locally and as production-scoped Netlify Functions secrets. The daily production worker is enabled. No local database override is configured in Netlify.

## Local review

The current local application is at `http://localhost:3000/market-outlook`. The active development checkout is `C:/Users/ToddGilmore/analytics` on `main`, aligned with GitHub and the published Netlify source. Older worktrees retain unfinished work and evidence; do not use them to restart the local app.

The local dev server uses the existing authentication and shared-database environment, so Outlook and WIP/KPI read the same saved data as production. The ignored `.tmp/start-current-local.mjs` launcher sets development mode and localhost URLs, omits isolated-market and file-WIP overrides, and verifies HEAD matches `origin/main`. Its local preload `.tmp/hide-dev-windows.cjs` keeps Next.js restart workers hidden. Launch with `Start-Process -WindowStyle Hidden` without `-Wait`; the hidden parent stays alive with the worker. Keys belong in ignored `.env.local` and production Functions secrets.

The older isolated public-data preview at `127.0.0.1:55432`, database `market_outlook`, is preserved as development evidence. Its cluster under `.tmp/market-outlook-postgres` is no longer the active app's source.

The active checkout has no `MARKET_DATABASE_URL` or `WIP_LOCAL_STORE_PATH` override. The old WIP worktree's environment remains separate; do not reuse those overrides when restarting the aligned application.

From the active checkout:

```text
node scripts/syncMarketOutlook.mjs
node scripts/syncMarketOutlook.mjs --apply
node scripts/syncMarketOutlook.mjs --apply --force
```

The default is a read-only fetch/validation run. `--apply` saves public data only. A remote target additionally requires `--allow-remote`; confirm the target first. `--force` bypasses the completed-run cooldown but never steals an active lease. CLI output contains status/counts, never provider credentials or raw error responses. Normal runs observe a one-hour cooldown. A killed worker's lease expires after two minutes, and a late worker cannot save after losing ownership.

Localhost reads shared observations. The production Netlify schedule runs daily at 15:15 UTC (11:15 a.m. Eastern during daylight saving time, 10:15 a.m. during standard time); it is not a local Windows task. Reloading the page does not contact publishers.

## Interpretation and limitations

- AIA diffusion indices use the published 50-point neutral level: above 50 is growth, below 50 is decline, exactly 50 is unchanged. Comparisons use index-point differences. These indices never enter the year-over-year demand counts.
- Other demand and cost signals use year-over-year comparisons with a +/-1% neutral band. Higher cost is pressure; higher demand is growth. This is an explicit planning heuristic, not a forecast or model of company revenue.
- Comparisons require the exact previous month/quarter/day or 52-week interval; gaps do not silently become period-over-period changes. Rate comparisons use percentage points.
- Current means the last successful check is within 48 hours and the observation is within the series-specific release-age threshold. A failed check retains saved values but removes directional signals until recovery.
- BLS PPI is an index, not delivered local prices. Steel mill PPI is a broad proxy. PA unemployment covers all industries. Weekly earnings reflect pay and hours worked. Nonresidential spending is nominal and annualized. Lending standards cover large/middle-market commercial and industrial loans, not commercial real-estate lending.
- Geography is explicit. Lancaster County plan submissions are connected separately from numeric indicators; they are not issued commercial permits or metro employment data.
- ABC, sector forecasts, regional architecture detail and local permits remain outside automatic ingestion. The page lists these coverage gaps without displaying the earlier curated snapshot or sector forecasts.

## Dodge public releases

The daily worker also checks Dodge's public WordPress REST endpoint at `https://www.construction.com/wp-json/wp/v2/posts`. No key is required. Category 4 is Dodge Momentum Index; category 5 is Total Construction Starts. Each request reads the six latest published releases in date order. These bounded windows seed recent trends and are not claimed to be complete historical datasets. The starts connector specifically extracts **nonresidential building** starts, excluding residential and nonbuilding infrastructure, and converts billion/trillion-dollar annual rates into the catalog's millions-of-dollars units.

`src/lib/marketDodge.ts` validates category, publication status/date, publisher URL, title/reporting month, index base and annual-rate units. It extracts numeric observations from release text; HTML is never rendered or saved. The reporting month is resolved against the publication year with a bounded completed-month check, including December/January rollover. Each point retains the public release URL and publication timestamp. DMI explicitly revised prior-month values take precedence over older publications, including across rolling fetch windows. Any unreadable release fails that series while retaining saved observations, rather than silently showing older data as a successful new refresh. There is no fallback to curated snapshots or inferred values. No annual signal is shown until a matching year-earlier observation exists.

New publishers require no schema migration: observations and release provenance use the existing `MarketSeriesSnapshot.points` JSON. Catalog groups now drive page placement directly, including Pipeline, without consulting the old curated snapshot. Source links on Dodge cards/history open the release supporting that observation.

## AIA public releases

`marketAia.ts` checks the ABI landing page plus the first three newsroom pages in parallel, then fetches at most three dated monthly press releases. National billings, project inquiries and new design-contract indices come from labeled public release text, with no account, key, PDF OCR or subscription. A shared fetch supplies all three series. HTML is bounded to 1 MB and never rendered or stored.

Each release requires matching publisher/canonical URL, publication metadata, dateline, reporting month and unambiguous national values in the 0–100 range. Regional/sector values cannot substitute for national indices. The latest parsed release must be at least as recent as the ABI landing page's latest reporting month. Missing or malformed releases fail the AIA batch and preserve prior observations. The bounded three-release window seeds recent trends, not a full historical dataset. Per-point source links and publication timestamps use existing snapshot JSON. No migration or new credential is required. Regional detail and sector forecasts remain outside this connector.

## Lancaster County development plans

The Outlook page includes the latest Lancaster County Planning Commission SALDO review list from public ArcGIS item `dd39ce8cada34c59adbfc463532c6577`, organization `I6XnrlnguPDoEObn`, layer 0 (`SALDO_points`). `marketLancaster.ts` requests only submission ID, county file number, project name/description, municipality, proposed use, application/plan type and review meeting date. It does not ingest applicant/owner contact fields or geometry. No new API key is required.

The existing daily worker fetches this list alongside the 16 numeric feeds and saves it under `lancaster-county-plan-reviews` in `MarketLocalSnapshot` using the same transaction and lease fence. The additive migration `20261015180000_market_local_snapshots` creates only this snapshot table. County submissions use `SALDO_Form_ID`; repeated parcel features with identical normalized details are deduplicated, while conflicting IDs, incomplete responses, count mismatches, schema drift and invalid dates fail the county refresh. Failed checks retain the last successful list. A successful refresh replaces the list, including a validated empty list; removed submissions are not presented as active or approved and no earlier county snapshots are displayed.

This is a rolling meeting list, not a complete inventory of county development, permits, approvals, starts or bid opportunities. A `Final Plan` classification is a submission type, not an approval. County publication and meeting dates are separate from our check time. Checks become overdue after 48 hours; source updates or the latest meeting older than 60 days display a county-publication warning. The section supports municipality, proposed-use and text filters; exact source links contain only the same allowlisted fields. Reads remain PostgreSQL-only, and a county read failure does not hide the national indicators.

Validate with `node --test test/marketLancaster.test.mjs` plus the existing market tests, `npx tsc --noEmit`, and desktop/mobile filter checks. The CLI dry run reports local status/counts alongside indicator results; the live worker adds a `local` summary without changing existing indicator result entries.

## Commercial / industrial / multifamily focus and Manheim Township

The default local view highlights commercial, industrial, institutional and apartment/multifamily building scope using `marketProjectFocus.ts`. Suggested categories are heuristics from published use, project title and description, not official zoning classifications or confirmed masonry scope. Single-family homes, residential garages, townhomes without explicit multifamily/apartment scope, lot changes and site-work-only plans are hidden by default. Mixed residential/business building work remains eligible. All records stay available using the scope selector; county-source residential labels alone do not establish apartment construction.

`marketManheim.ts` fetches both layers of Manheim Township's public `Plan_Development_Map` FeatureServer, linked from its official Planning & Zoning page. It validates exact layer identities, required fields, status-domain meanings, counts, transfer limits, dates and source drawing links. Project identity is layer ID plus OBJECTID, never name/address; records across county and township sources are not merged or summed as unique projects. Explicit PlanStatus values UR/A/UC map to Under review/Approved/Under construction. The active layer's title does not imply construction, Final Plan does not imply approval, and DatePosted is a listing date rather than an approval or permit date. The UI labels it Tracker posted, explicitly marks approval dates as unavailable, and labels successful refreshes Feed check current. Shared posting dates must not be interpreted as new or simultaneous approvals. A date incorrectly entered by the publisher in DevelopmentType is displayed as unspecified; the description still supports the suggested category. Drawing links are limited to HTTPS township DocumentCenter URLs.

The existing market worker saves `manheim-township-development` in `MarketLocalSnapshot` with the same lease fence, replacement-on-success and retention-on-failure behavior. Both township layers must validate before replacing its snapshot; individual feed failures remain visible. This requires no migration or key. The older of the two layer update timestamps drives the 60-day source-age warning; successful checks expire after 48 hours. Ordinary page loads read PostgreSQL only. Manheim's focused view defaults to reported approvals/construction, with filters for all stages and all projects. Issued building permits are still outside coverage. Validate `test/marketProjectFocus.test.mjs`, `test/marketManheim.test.mjs`, existing market tests, type check, and browser scope/status/search checks.

## Lancaster City and nearby municipal records

`marketMunicipal.ts` adds seven independently saved source checks to the same daily worker and fenced transaction. `MunicipalCoverage.tsx` reads them through `loadMarketOutlook.ts`; ordinary renders never fetch municipal websites. No migration or new key is required. Successful checks replace each source's records; failures preserve its prior data and last success. Check freshness expires after 48 hours. Only the latest linked Planning Commission agenda and latest minutes are retained per municipality, with the actual meeting date (not upload-folder or website-check date), cancellation/upcoming labels and a warning for meetings older than 90 days. These documents cover all planning business; their discovery does not classify projects or establish approval, construction, or permit issuance.

- Lancaster City: [official Planning Commission records](https://www.cityoflancasterpa.gov/boards-commissions-and-authorities/planning-commission/). Its former public viewer is unavailable; the City's public ArcGIS organization still publishes `SALDO_Approvals_RO` (item `b45287e5cd764940afdc377dbdf5e3b3`, org `jdavPUqnBVRDsKgB`, also referenced by public map `a61b0ad8403e44ccb197a7d102d33660`). As checked October 15, 2026, the newest dated record is July 7, 2023 and the layer update is November 3, 2025. A bounded newest-record query checks source age daily using only OBJECTID and MeetingDate; historical project rows are not imported. Current city approvals/permits remain unconnected even if the feed later updates, pending review of its project contract. The separate public commercial-permit layer was last updated December 7, 2021 and is not connected. Current minutes are linked from the official page, but automated retrieval was unavailable during this audit.
- West Hempfield: [plans under review](https://www.westhempfield.org/subpage.php?link=plans). Two plan links were listed at initial connection: Goddard School and Taylor Chip. Store the published name and exact drawing URL as identity; never infer a posting/approval date from a filename. The page cautions that drawings may have newer revisions. No currentness claim is made without publication dates.
- East Hempfield and Lancaster Township: their official Planning Commission agenda/minute pages. Relative document links use the sites' declared origin base. Meeting dates come from the containing row.
- East Lampeter: the current-year [meeting archive](https://eastlampetertownship.org/2026-meeting-archives/), Planning Commission section only. Dates and cancellation labels come from the meeting section.
- West Lampeter: [Agenda Center](https://www.westlampeter.com/AgendaCenter), Planning Commission category 3 only. Meeting dates come from the stable agenda identifier, not the separate posted/amended date.
- Manor: current-year [meeting records](https://manortownship.net/2026-meeting-minutes-and-agenda/), Planning Commission section only. Dates come from the containing meeting row.

Adapters bound HTML size/record counts, validate section markers and dates, accept only HTTPS documents on the municipality's own domain, and reject missing/ambiguous records rather than overwrite saved evidence. An empty West Hempfield list requires adapter review because its page has no validated empty-list marker. Annual archive URLs roll with the year; missing/new layouts remain visible failures until validated. No municipality totals are combined into a unique-project count. Validate `node --test test/marketMunicipal.test.mjs` along with existing market tests, type check, focused lint, a public-source dry run and browser layout checks.

## Validation and release

```text
node --test test/marketFeeds.test.mjs test/marketDodge.test.mjs test/marketAia.test.mjs test/marketOutlook.test.mjs test/permissions.test.mjs test/helpGuides.test.mjs
npx tsc --noEmit
```

Before an explicitly authorized production release, review the additive migration `20261015150000_market_outlook_feeds`, configure provider keys and scheduler variables, and use the repository's GitHub/Netlify release process and published-commit ancestry checks. Production should normally omit the local-only `MARKET_DATABASE_URL`. Verify all 16 feeds after the initial sync and retain per-source failure visibility. Do not run the repository build merely to validate this feature; it deploys migrations to the configured database.
