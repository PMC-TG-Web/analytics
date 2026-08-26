# Repository instructions

## Start here

- Read `docs/architecture.md` before changing project identity, scheduling, Procore sync, analytics, accounting, authentication, or permissions.
- Check `git status --short` before editing. This repository often contains active local work; preserve unrelated changes and generated evidence.
- Treat the current code, `prisma/schema.prisma`, and migrations as authoritative. Several older root-level design notes describe earlier implementations.

## Stack and layout

- Next.js 16 App Router with React 19 and TypeScript. The `@/*` alias points to `src/*`.
- PostgreSQL through Prisma 6. The shared client is `src/lib/prisma.ts`.
- Netlify hosts the app and runs scheduled/background functions from `netlify/functions/`.
- Pages live under `src/app/**/page.tsx`; route handlers live under `src/app/api/**/route.ts`.
- Shared domain code belongs in `src/lib/`; one-off operational tools belong in `scripts/`; focused tests belong in `test/`.

## Core contracts

- Analytics pages read PostgreSQL. Do not add direct Procore API calls to page renders or ordinary analytics reads; ingest external data through controlled sync routes/workers first.
- `PmcProject`/`pmc_projects` is the canonical project-identity direction, keyed by `companyId + procoreProjectId`. Legacy `Project`, scheduling tables, and Gantt v2 tables are still used. Preserve existing compatibility and dual-write paths unless a migration task explicitly proves they can be removed.
- A Procore project ID, bid-board project ID, proposal ID, and local Prisma ID are different identifiers. Do not interchange them or join projects by name, customer, number, or `jobKey` when an explicit external ID is available.
- Centralize Procore HTTP behavior in `src/lib/procore.ts` and the focused `src/lib/procore*.ts` modules. Respect the live-API gate, company header, retry/rate-limit handling, and secret-authenticated worker bypasses.
- QuickBooks profitability data is imported as read-only, immutable snapshots. Do not add QuickBooks write operations or expose QuickBooks/Procore credentials to the browser.
- Authentication and authorization are separate: Auth0 establishes the session; `middleware.ts`, `src/lib/permissionRoutes.js`, and `src/lib/permissions.ts` enforce route permissions. Update the page/API rule and its tests together when adding a protected surface.

## Safety and data changes

- Never commit `.env*`, access tokens, client secrets, pairing keys, webhook secrets, database URLs, or copied production payloads containing sensitive data.
- Do not log tokens or full authorization headers. Use environment-variable names in documentation and examples, never real values.
- Prefer additive Prisma migrations and idempotent `upsert`-based backfills. Do not run resets, hard deletes, repair scripts, or live Procore mutations unless the task explicitly authorizes the exact target and mode.
- Treat scripts named `delete`, `repair`, `reconcile`, `freshSync`, or similar as operational tools. Inspect their arguments, defaults, target company/project IDs, and dry-run behavior before running them.
- Avoid editing generated or transient content unless it is the task target: `.next/`, `out/`, `.netlify/`, `.tmp/`, `logs/`, `snapshots/`, build logs, exports, and local spreadsheet/CSV evidence.

## Implementation workflow

- Keep route handlers thin when practical; place reusable normalization, matching, calculations, and sync logic in `src/lib/` so it can be tested without starting Next.js.
- Preserve existing API response shapes and no-store behavior unless the change intentionally versions the contract.
- Use Prisma for normal CRUD. Raw SQL is common for reporting, materialized views, transitional tables, and database features not represented cleanly by generated types; parameterize values and document identity assumptions.
- Reuse the existing retry, queue, canonicalization, permissions, and analytics helpers before creating parallel implementations.
- Add or update a focused `node:test` case for changed business logic. Tests may import `.ts` modules directly under the repository's Node 22 setup.
- Update `docs/architecture.md` when a change moves an entry point, source of truth, identifier contract, worker flow, or validation command.

## Validation

- Focused test: `node --test test/<name>.test.mjs`
- All tests: `npm test`
- Type check: `npx tsc --noEmit`
- Lint: `npm run lint`
- Full non-build validation: `npm run verify`
- `npm run build` first runs migration-recovery and `prisma migrate deploy` scripts against the configured database. Confirm the intended database target before using it as a routine validation command.
