# Database Rebuild Audit

Date: 2026-06-15

## Goal

Rebuild the backend database around a cleaner schema with one canonical project identity, fewer duplicate scheduling tables, and a safer path for Procore sync data.

The current `prisma/schema.prisma` already includes a proposed v2 core at the bottom:

- `PmcProject` mapped to `pmc_projects`
- `PmcProjectScope` mapped to `pmc_project_scopes`
- `PmcScheduleEntry` mapped to `pmc_schedule_entries`
- `PmcScheduleAllocation` mapped to `pmc_schedule_allocations`
- `PmcSyncLog` mapped to `pmc_sync_logs`

That v2 direction is sound. The next work is to migrate the app and data toward it deliberately.

## Current Schema Shape

The existing schema falls into six groups.

| Group | Current models/tables | Recommendation |
| --- | --- | --- |
| Legacy project identity | `Project`, `ProjectScope`, `Schedule`, `ScheduleAllocation`, `ActiveSchedule`, `ScopeTracking` | Merge into the v2 `pmc_*` tables. Keep temporarily during backfill and app migration. |
| Gantt v2 | `GanttV2Project`, `GanttV2Scope`, `GanttV2ScheduleEntry` | Merge into `pmc_project_scopes` and `pmc_schedule_entries`, then retire after parity checks. |
| Procore transactional sync | `ProductivityLog`, `TimecardEntry`, `TimecardTimeType`, `CommitmentContract`, `CommitmentChangeOrder`, `PurchaseOrderContract`, `PurchaseOrderLineItemContractDetail`, unpacked field tables | Keep, but migrate joins from local `projectId` to canonical `company_id + procore_project_id`. Consider renaming only after behavior is stable. |
| Procore raw/live mirrors | `procore_*_live`, `bidforms`, `bidpackages`, `bids`, `BudgetLineItem`, staging tables, webhook tables | Keep as raw/live sync mirrors. Normalize important query fields, keep `payload` JSON for source fidelity. |
| App-owned data | `KPIEntry`, `DashboardSummary`, `AuditLog`, `User`, `Employee`, `JobTitle`, `Holiday`, `TimeOffRequest`, `CrewTemplate`, `HandbookSignoff`, `EstimatingConstant`, `RebarConstant`, `Certification`, `Equipment`, `EquipmentAssignment`, `OnboardingSubmission`, `ConcreteOrder` | Keep. These are not the source of the project identity problem. Update foreign keys/references only where they point at legacy `Project`. |
| Backups/temporary history | `project_*_backup_*`, archived scripts, old one-off staging artifacts | Drop from the clean Prisma schema after confirming database backups exist. Do not carry these into v2. |

## Target Core

The target backbone should be:

| Target table | Purpose | Replaces / absorbs |
| --- | --- | --- |
| `pmc_projects` | One canonical project row keyed by Procore project ID. | `Project`, parts of `GanttV2Project`, parts of Procore project staging/live data. |
| `pmc_project_scopes` | Work breakdown/scope rows for scheduling and Gantt. | `ProjectScope`, `GanttV2Scope`. |
| `pmc_schedule_entries` | Daily project/scope/date schedule rows. | `ActiveSchedule`, `GanttV2ScheduleEntry`. |
| `pmc_schedule_allocations` | Monthly long-term schedule allocations. | `Schedule`, `ScheduleAllocation` where they only exist to support monthly allocation. |
| `pmc_sync_logs` | Per-project, per-data-type sync status. | Some uses of `SyncLog`; can coexist until the new sync flow is complete. |

## Redundancy Cleanup Policy

The rebuild should reduce table count and remove improvised naming. A table should survive only if it has a distinct responsibility.

Keep a separate table when it is:

- a canonical app-owned entity, such as users, employees, equipment, projects, or schedules
- a Procore source mirror with a clear endpoint/data type
- a many-to-many relationship or history/audit table
- a high-value derived table/materialized view with documented refresh rules

Merge or retire a table when it is:

- another representation of the same project/schedule fact
- a temporary staging, backup, debug, or one-off migration table
- only present because fuzzy matching needed extra helpers
- named after implementation history instead of business meaning
- a duplicate raw/live table for the same Procore endpoint

Normal runtime code should not depend on backup, scratch, diagnostic, or fuzzy-match tables.

## Consolidation Map

| Current table/model family | Target | Action |
| --- | --- | --- |
| `Project` | `pmc_projects` | Merge, then retire. |
| `ProjectScope` | `pmc_project_scopes` | Merge, then retire. |
| `Schedule` | `pmc_schedule_allocations` plus project metadata already in `pmc_projects` | Merge, then retire. |
| `ScheduleAllocation` | `pmc_schedule_allocations` | Merge, then retire. |
| `ActiveSchedule` | `pmc_schedule_entries` | Merge, then retire. |
| `ScopeTracking` | derived from `pmc_project_scopes` and `pmc_schedule_entries` | Retire unless a stored summary is proven necessary. |
| `GanttV2Project` | `pmc_projects` | Merge, then retire. |
| `GanttV2Scope` | `pmc_project_scopes` | Merge, then retire. |
| `GanttV2ScheduleEntry` | `pmc_schedule_entries` | Merge, then retire. |
| `project_*_backup_*` | database backup files/snapshots | Drop from clean schema after backup verification. |
| `ProcoreProjectStaging` | `pmc_projects` plus Procore raw mirror if needed | Retire after the project sync writes explicit IDs correctly. |
| `ProcoreProjectStagingUnpackedField` | raw payload JSON or documented extracted columns | Retire unless a current query depends on arbitrary unpacked fields. |
| `procore_bid_board_live` | `procore_bid_board_projects` or keep existing table with cleaned model name | Keep, but standardize ID names. |
| `bidpackages` | `procore_bid_packages` | Keep/rename. |
| `bidforms` | `procore_bid_forms` | Keep/rename. |
| `bids` | `procore_bids` | Keep/rename. |
| `BudgetLineItem` / `budgetlineitems` | `procore_budget_line_items` | Keep/rename, keyed by `company_id + procore_project_id + budget_line_item_id`. |
| `ProductivityLog` | `procore_productivity_logs` | Keep/rename, keyed by Procore log ID where available. |
| `TimecardEntry` | `procore_timecard_entries` | Keep/rename, keyed by Procore entry ID. |
| `TimecardTimeType` | `procore_timecard_time_types` | Keep/rename. |
| `CommitmentContract` | `procore_commitment_contracts` | Keep/rename. |
| `CommitmentChangeOrder` | `procore_commitment_change_orders` | Keep/rename. |
| `CommitmentChangeOrderLineItem` | `procore_commitment_change_order_line_items` | Keep/rename. |
| `PurchaseOrderContract` | `procore_purchase_order_contracts` | Keep/rename. |
| `PurchaseOrderLineItemContractDetail` | `procore_purchase_order_line_item_details` | Keep/rename. |
| `*_unpacked_fields` tables | documented extracted columns or raw `payload` JSON | Retire where possible; keep only if flexible querying is actively needed. |
| `PmcGroupMapping`, `PMCGroup`, `CostitemPMCMapping`, `CostCodeCategory`, `TimecardCostCodeMapping` | `pmc_cost_code_mappings` / `pmc_cost_code_categories` | Consolidate into fewer cost-code mapping tables. |
| `User` | `app_users` | Keep/rename. Consider simple permissions column first. |
| `AuditLog` | `app_audit_logs` | Keep/rename. |
| `SyncLog` | `app_sync_runs` or global sync log | Keep only for global run-level logging; use `pmc_sync_logs` for project-level sync state. |
| `KPIEntry`, `DashboardSummary` | `pmc_kpi_entries`, derived dashboard views | Keep KPI entries; retire dashboard summary if it can be derived cheaply. |
| `Employee`, `JobTitle`, `job_titles` | `app_employees`, `app_job_titles` | Consolidate duplicate job title models/tables. |
| `ConcreteOrder` | `pmc_concrete_orders` | Keep/rename. |
| `long_term_pm_assignments` | `pmc_project_manager_assignments` | Keep/rename if still used. |

## Key Design Rules

1. `company_id` is fixed to the Procore company ID `598134325805519` unless a future multi-company requirement is explicitly introduced.
2. Project-linked rows must join by `company_id + procore_project_id`.
3. `procore_project_id` means the Procore project ID used for project-scoped Procore APIs.
4. `bid_board_id` means the Procore bid board project ID. It is related to, but not interchangeable with, `procore_project_id`.
5. Legacy `Project.id` should not be the long-term join key.
6. `jobKey`, project name, customer, and project number should become display/import compatibility fields, not primary identity.
7. Schedule rows should be direct facts: company, Procore project, optional scope, date, hours, manpower, source.
8. Long-term allocation rows should be direct facts: company, Procore project, month, hours, optional percent.
9. Procore mirror tables should preserve raw `payload` JSON and expose frequently queried ID columns.
10. Duplicate/backup tables should stay out of the clean schema.

## Identity Contract

The rebuild should make fuzzy joins hard to write by accident.

| Concept | Required column name | Meaning |
| --- | --- | --- |
| Company | `company_id` | Procore company ID. Current value: `598134325805519`. |
| Procore project | `procore_project_id` | Procore project ID. This is the primary project identity for app joins. |
| Bid board project | `bid_board_id` | Procore bid board project ID. Used for bid board/proposal APIs. |
| Proposal | `proposal_id` | Procore estimating proposal ID. |
| Bid package | `bid_package_id` | Procore bid package ID. |
| Bid form | `bid_form_id` | Procore bid form ID. |
| Bid | `bid_id` | Procore bid ID. |
| Budget line item | `budget_line_item_id` | Procore budget line item ID. |
| Timecard entry | `timecard_entry_id` | Procore timecard entry ID. |
| Commitment contract | `commitment_contract_id` | Procore commitment contract ID. |

Normal app reads and writes should not match project data by name, customer, project number, status, or `jobKey`. Those fields can be used in diagnostics and one-time repair reports, but the result should be reviewed and written back as explicit IDs before the app relies on it.

## Migration Strategy

Use a staged migration, not a destructive reset.

### Phase 1 - Baseline audit

- Take a full Postgres backup.
- Export table row counts.
- Export duplicate project candidates grouped by legacy `Project.procoreId`, `projectNumber`, and normalized project name.
- Export orphan counts for schedule/scope/commercial tables that point at missing projects.
- Confirm whether every active project row has a usable Procore project ID.

Deliverables:

- `snapshots/schema-audit/<timestamp>-row-counts.json`
- `snapshots/schema-audit/<timestamp>-project-duplicates.csv`
- `snapshots/schema-audit/<timestamp>-orphans.json`

### Phase 2 - Create v2 tables

- Add a migration that creates the v2 `pmc_*` tables.
- Keep existing tables in place.
- Add indexes and foreign keys only where current data can satisfy them.
- Do not drop legacy tables in this phase.

### Phase 3 - Backfill v2

Backfill in this order:

1. `pmc_projects`
2. `pmc_project_scopes`
3. `pmc_schedule_allocations`
4. `pmc_schedule_entries`
5. `pmc_sync_logs`

Backfill rules:

- Prefer explicit Procore project IDs from legacy `Project.procoreId` or Procore source payloads.
- When several legacy projects share a Procore ID, choose the keeper by non-archived status, richer commercial data, and most recent update.
- Write rejected/ambiguous rows to review files instead of guessing silently.
- Make scripts idempotent with `upsert`.

### Phase 4 - Read-path migration

Move reads to v2 tables in this order:

1. diagnostics/check scripts
2. project lookup APIs
3. long-term schedule APIs
4. short-term schedule APIs
5. Gantt v2 APIs
6. dashboard/reporting queries

The heavy-use code areas currently scanning legacy tables include:

- `src/app/api/projects/route.ts`
- `src/app/api/short-term-schedule/route.ts`
- `src/app/api/schedule-allocations/route.ts`
- `src/app/api/project-scopes/route.ts`
- `src/app/api/project-schedule/route.ts`
- `src/app/api/long-term-schedule/route.ts`
- `src/lib/ganttV2Db.ts`
- `src/utils/syncActiveSchedule.ts`
- `src/lib/scheduling/ganttScopeSync.ts`
- `src/lib/scheduling/ganttScopeToPrismaScope.ts`

### Phase 5 - Write-path migration

Move writes after read parity is proven:

- Procore project sync writes `pmc_projects`.
- Scope editing writes `pmc_project_scopes`.
- Daily scheduling writes `pmc_schedule_entries`.
- Long-term allocations write `pmc_schedule_allocations`.
- Gantt sync becomes a translation layer over `pmc_project_scopes` and `pmc_schedule_entries`.

### Phase 6 - Parity checks

Before retiring old tables, compare old vs new:

- project count by status
- project count by customer
- active/non-archived project count
- monthly scheduled hours
- daily scheduled hours by project
- scope count by project
- dashboard scheduled sales/hours
- budget/commitment/timecard/productivity project coverage

### Phase 7 - Retire legacy tables

Only after parity checks pass:

- Remove app references to `Project`, `ProjectScope`, `Schedule`, `ScheduleAllocation`, `ActiveSchedule`, and `GanttV2*`.
- Archive or drop backup tables.
- Remove ignored backup models from Prisma.
- Keep raw Procore mirror tables unless they are proven unused.

## Backfill Mapping

| v2 field | Preferred source | Fallback source |
| --- | --- | --- |
| `PmcProject.procoreProjectId` | legacy `Project.procoreId` | Procore project live/staging payload project ID |
| `PmcProject.companyId` | `598134325805519` | Procore mirror/staging company ID if multi-company is introduced later |
| `PmcProject.bidBoardId` | legacy `Project.bidBoardId` | Procore bid board live/staging payload bid board ID |
| `PmcProject.projectNumber` | `Project.projectNumber` | Procore payload number |
| `PmcProject.projectName` | `Project.projectName` | Procore payload name |
| `PmcProject.customer` | canonical customer from deduped `Project` | Procore payload customer/client fields |
| `PmcProject.status` | `Project.status` / Procore status | Procore stage/status payload |
| `PmcProject.bidBoardStatus` | bid board live payload | existing status source if marked bid-board |
| `PmcProjectScope.title` | `ProjectScope.title` | `GanttV2Scope.title` |
| `PmcProjectScope.startDate` | `ProjectScope.startDate` | `GanttV2Scope.startDate` |
| `PmcProjectScope.endDate` | `ProjectScope.endDate` | `GanttV2Scope.endDate` |
| `PmcScheduleEntry.date` | `ActiveSchedule.date` | `GanttV2ScheduleEntry.date` |
| `PmcScheduleEntry.hours` | `ActiveSchedule.hours` | `GanttV2ScheduleEntry.hours` |
| `PmcScheduleAllocation.month` | `ScheduleAllocation.period` when `periodType = month` | derive from schedule data only if unambiguous |

## Open Decisions

- Whether `PmcScheduleEntry.scopeId` should be nullable long-term. It is useful for imports/manual rows, but stricter scope links make Gantt cleaner.
- Whether `SyncLog` should be retained for global sync runs while `PmcSyncLog` tracks per-project sync state.
- Whether commercial tables should eventually use explicit foreign keys to `pmc_projects(company_id, procore_project_id)` or keep looser `procoreProjectId` indexes.
- Whether to squash migrations for a truly clean deployment database or keep migration history and add v2 migrations on top.

## Immediate Next Step

Build `scripts/auditDatabaseForV2.mjs` to produce:

- row counts for all Prisma models
- duplicate project groups
- rows missing Procore project IDs
- orphaned schedule/scope/commercial rows
- candidate `pmc_projects` backfill preview

Then run it against staging or a copied production database before writing any destructive migration.
