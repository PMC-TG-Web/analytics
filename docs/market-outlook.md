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

The current local application is at `http://localhost:3000/market-outlook`. The active development checkout is `C:/Users/ToddGilmore/analytics-wip-20261012`; the directory name does not mean this feature modifies the WIP page.

The local dev server also needs the existing application's authentication and shared-database environment. Its current local launcher `.tmp/market-start-local.mjs` loads the active checkout's environment first, then fills missing settings from the original `analytics` checkout. A bare dev-server restart without that existing environment will break navigation/permissions even though the isolated market data still loads.

The isolated PostgreSQL preview listens only on `127.0.0.1:55432`, database `market_outlook`, role `market_preview`, with no password and loopback trust. Its cluster is under `C:/Users/ToddGilmore/analytics/.tmp/market-outlook-postgres`. Only the two market tables were created there, using the new migration SQL; no shared-database migrations ran. This disposable public-data cluster is not suitable for production or sensitive data.

If the preview database needs restarting after reboot, use PostgreSQL 17 `pg_ctl` with that data directory, `-o "-p 55432 -h 127.0.0.1"`, and a log file under the same directory. Start background processes hidden. The `.env.local` file in the active checkout contains the local database override.

From the active checkout:

```text
node scripts/syncMarketOutlook.mjs
node scripts/syncMarketOutlook.mjs --apply
node scripts/syncMarketOutlook.mjs --apply --force
```

The default is a read-only fetch/validation run. `--apply` saves public data only. A remote target additionally requires `--allow-remote`; confirm the target first. `--force` bypasses the completed-run cooldown but never steals an active lease. CLI output contains status/counts, never provider credentials or raw error responses. Normal runs observe a one-hour cooldown. A killed worker's lease expires after two minutes, and a late worker cannot save after losing ownership.

The local preview has been populated by explicit CLI syncs. The production Netlify schedule runs daily at 15:15 UTC (11:15 a.m. Eastern during daylight saving time, 10:15 a.m. during standard time); it is not a local Windows task. Reloading the page does not contact publishers.

## Interpretation and limitations

- Demand and cost signals use year-over-year comparisons with a +/-1% neutral band. Higher cost is pressure; higher demand is growth. This is an explicit planning heuristic, not a forecast or model of company revenue.
- Comparisons require the exact previous month/quarter/day or 52-week interval; gaps do not silently become period-over-period changes. Rate comparisons use percentage points.
- Current means the last successful check is within 48 hours and the observation is within the series-specific release-age threshold. A failed check retains saved values but removes directional signals until recovery.
- BLS PPI is an index, not delivered local prices. Steel mill PPI is a broad proxy. PA unemployment covers all industries. Weekly earnings reflect pay and hours worked. Nonresidential spending is nominal and annualized. Lending standards cover large/middle-market commercial and industrial loans, not commercial real-estate lending.
- Geography is explicit. The current connectors do not claim metro-level or local commercial-permit coverage.
- AIA, ABC, sector forecasts and local permits remain outside automatic ingestion. The page lists these coverage gaps without displaying the earlier curated snapshot or sector forecasts.

## Dodge public releases

The daily worker also checks Dodge's public WordPress REST endpoint at `https://www.construction.com/wp-json/wp/v2/posts`. No key is required. Category 4 is Dodge Momentum Index; category 5 is Total Construction Starts. Each request reads the six latest published releases in date order. These bounded windows seed recent trends and are not claimed to be complete historical datasets. The starts connector specifically extracts **nonresidential building** starts, excluding residential and nonbuilding infrastructure, and converts billion/trillion-dollar annual rates into the catalog's millions-of-dollars units.

`src/lib/marketDodge.ts` validates category, publication status/date, publisher URL, title/reporting month, index base and annual-rate units. It extracts numeric observations from release text; HTML is never rendered or saved. The reporting month is resolved against the publication year with a bounded completed-month check, including December/January rollover. Each point retains the public release URL and publication timestamp. DMI explicitly revised prior-month values take precedence over older publications, including across rolling fetch windows. Any unreadable release fails that series while retaining saved observations, rather than silently showing older data as a successful new refresh. There is no fallback to curated snapshots or inferred values. No annual signal is shown until a matching year-earlier observation exists.

New publishers require no schema migration: observations and release provenance use the existing `MarketSeriesSnapshot.points` JSON. Catalog groups now drive page placement directly, including Pipeline, without consulting the old curated snapshot. Source links on Dodge cards/history open the release supporting that observation.

## Validation and release

```text
node --test test/marketFeeds.test.mjs test/marketDodge.test.mjs test/marketOutlook.test.mjs test/permissions.test.mjs test/helpGuides.test.mjs
npx tsc --noEmit
```

Before an explicitly authorized production release, review the additive migration `20261015150000_market_outlook_feeds`, configure provider keys and scheduler variables, and use the repository's GitHub/Netlify release process and published-commit ancestry checks. Production should normally omit the local-only `MARKET_DATABASE_URL`. Verify all 13 feeds after the initial sync and retain per-source failure visibility. Do not run the repository build merely to validate this feature; it deploys migrations to the configured database.
