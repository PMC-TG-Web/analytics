# Scheduled Hours Sync Solution

## Problem
When you scheduled 5 people (50 hours) on a job, those hours appeared on the long-term schedule but NOT on the scope cards in the project schedule page showing "Sch 0" instead of "Sch 50".

## Root Cause
Two separate scheduling systems:
1. **Job Scheduling** (`/scheduling` page) - Stores allocations in `Schedule` and `ScheduleAllocation` tables
2. **Gantt V2 Scopes** (`/project-schedule` page) - Stores scheduled hours in `gantt_v2_schedule_entries` table

These systems weren't talking to each other.

## Solution Implemented

### 1. New Sync Function
Added `syncActiveScheduleToScope()` in `src/lib/ganttV2Db.ts`:
- Finds all `activeSchedule` entries for a given jobKey
- Aggregates hours by work_date
- Creates/updates `gantt_v2_schedule_entries` records

**How it works:**
```typescript
// Flow: Job Allocations → activeSchedule → gantt_v2_schedule_entries
Schedule (allocations) 
  → syncAllocationToActiveSchedule() creates activeSchedule entries
  → syncActiveScheduleToScope() reads activeSchedule
  → Updates gantt_v2_schedule_entries
  → Scope card displays updated "Sch" hours
```

### 2. New API Endpoint
Created POST `/api/gantt-v2/sync-schedule`:
- Accepts `projectId` + `projectNumber` to sync all scopes
- Or `scopeId` + `jobKey` to sync a specific scope
- Returns all synced hours

### 3. Automatic Syncing
Updated `src/app/project-schedule/page.tsx`:
- When you open a project's scopes modal
- It automatically calls `syncActiveScheduleToScope()` 
- Pulls in hours from your job allocations
- Refreshes the scope display with updated "Sch" values

## How to Use

### Option A: Manual Sync (via API)
```bash
curl -X POST http://localhost:3000/api/gantt-v2/sync-schedule \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<project-id>","projectNumber":"<project-number>"}'
```

### Option B: Automatic (when opening project)
1. Go to `/project-schedule`
2. Click on a project to expand it
3. Open the scopes modal
4. The sync happens automatically
5. "Sch" hours will update to match your allocations

## Mapping Between Systems

| Old System | New System |
|-----------|-----------|
| Schedule (jobKey) | activeSchedule (job_key) |
| ScheduleAllocation (hours by month) | activeSchedule entries (hours by date) |
| — | gantt_v2_schedule_entries (hours per scope) |

The sync uses:
1. Project Number to find matching Schedule records
2. Schedule's jobKey to find activeSchedule entries
3. Aggregated activeSchedule hours to populate scope scheduled hours

## Data Flow Example

You scheduled 5 people × 10 hours = 50 hours on "2508_CP~2508" job:

1. **Entered on scheduling page**
   - jobKey: "2508_CP~2508"
   - Month: March 2026
   - Hours: 50

2. **Saved to Schedule/ScheduleAllocation**
   - Creates Schedule record
   - Creates ScheduleAllocation (50 hours for 2026-03)

3. **Synced to activeSchedule**
   - syncAllocationToActiveSchedule() creates daily entries
   - activeSchedule table has 50 hours distributed across March dates

4. **Now syncs to gantt_v2_schedule_entries** (NEW!)
   - syncActiveScheduleToScope() reads activeSchedule
   - Creates gantt_v2_schedule_entries records
   - Scope card shows "Sch 50"

## What Changed

### Files Modified:
1. `src/lib/ganttV2Db.ts` - Added syncActiveScheduleToScope()
2. `src/app/project-schedule/page.tsx` - Auto-sync on load
3. `src/app/api/gantt-v2/sync-schedule/route.ts` - New endpoint

### No Breaking Changes:
- Existing scope functionality unchanged
- Manual entry still works
- Job allocations still work
- All existing data preserved

## Testing

To verify it's working:
1. Go to `/scheduling` page
2. Enter allocations for a job (e.g., 50 hours for March)
3. Click "Save"
4. Go to `/project-schedule`
5. Open the project's scopes
6. The "Sch" value should now show the hours from step 2
7. Check the long-term schedule to see the hours displayed there too

## Troubleshooting

If "Sch" hours still show 0:
1. Verify you saved allocations on `/scheduling` page
2. Check that the scope's project has a matching projectNumber
3. Verify activeSchedule has entries for your jobKey
   - Check long-term schedule (it should show those hours)
4. Manually open scopes modal again to trigger sync

## Next Steps

Future improvements:
- Real-time sync (trigger on schedule save)
- UI button to manually refresh/sync
- Sync history/audit trail
- Two-way sync (edit scope → update allocations)
