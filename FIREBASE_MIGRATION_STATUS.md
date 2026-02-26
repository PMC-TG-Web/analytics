# Firebase to Postgres Migration Status

## Critical Files to Migrate (Production App Code)

### Utilities (src/utils/)
- [ ] activeScheduleUtils.ts
- [ ] activeScheduleLoader.ts
- [ ] scheduleSync.ts

### API Routes (src/app/api/)
- [ ] scheduling/route.ts
- [ ] procore/sync-productivity/route.ts
- [ ] admin/cleanup-generic-scopes/route.ts
- [ ] importCsv/route.ts
- [ ] daySchedule/route.ts

### Main Pages (src/app/)
- [ ] kpi/page.tsx (Partially done - needs Firebase project imports removed)
- [ ] dashboard/page.tsx
- [ ] crew-management/page.tsx
- [ ] constants/page.tsx
- [ ] holidays/page.tsx
- [ ] long-term-schedule/page.tsx
- [ ] short-term-schedule/page.tsx
- [ ] wip/page.tsx
- [ ] scheduling/page.tsx
- [ ] projects/page.tsx
- [ ] test-schedules/page.tsx
- [ ] project-schedule/ (hooks and components)
- [ ] productivity/page.tsx
- [ ] page.tsx (home page)
- [ ] onboarding/ pages
- [ ] estimating-tools/page.tsx
- [ ] equipment/page.tsx
- [ ] field/page.tsx
- [ ] employees/ pages
- [ ] daily-crew-dispatch-board/page.tsx

### Scripts (src/scripts/)
- [ ] Various bootstrap and debug scripts (Can be deleted or updated later)

## Strategy:
1. ✅ Update Prisma schema with all models
2. ✅ Remove Firebase from package.json
3. ✅ Delete Firebase config files
4. ⏳ Update critical utilities (activeScheduleUtils, scheduleSync, activeScheduleLoader)
5. ⏳ Update API routes
6. ⏳ Update main pages
7. ⏳ Update remaining pages
8. ⏳ Delete/archive scripts
9. ⏳ Remove all Firebase imports and fix build errors

## Notes:
- Using clean slate approach (no data export from Firebase)
- Will use Prisma as exclusive database layer
- Some pages may need significant refactoring if they use complex Firebase queries
