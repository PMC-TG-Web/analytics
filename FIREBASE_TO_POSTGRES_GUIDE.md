# Firebase to Postgres Migration Guide

## Completion Status

✅ **COMPLETED:**
1. Prisma schema expanded with 8 new models (Project, ProjectScope, Schedule, ActiveSchedule, ScopeTracking, ProductivityLog, ProductivitySummary, DashboardSummary)
2. Database migration created and applied to Vercel Postgres  
3. Firebase dependencies removed from package.json
4. Critical utilities updated to Prisma:
   - activeScheduleUtils.ts (full migration)
   - projectQueries.ts (full migration)
5. prismaActiveScheduleUtils.ts helper created
6. Stub firebase.ts and firebaseConfig.json created for migration compatibility
7. FIREBASE_MIGRATION_STATUS.md created tracking all files needing updates

⏳ **IN PROGRESS (74 Files Remaining):**
- Routes still using Firebase
- Pages still using Firebase  
- Components still using Firebase
- Scripts using Firebase

## Next Steps: Complete the Migration

### Phase 1: Replace Remaining Firebase Calls (High Priority - Blocking Build)

The build currently has 74 errors because Firebase code is trying to call methods on a stub object. You have two options:

#### Option A: Systematic Code Replacement (Recommended for long-term)
Replace Firebase calls in each file with Prisma equivalents:

**Pattern to Replace:**
```typescript
// Firebase
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/firebase';

const data = await getDocs(query(collection(db, 'projects'), where('status', '==', 'Bid Submitted')));

// Prisma
import { prisma } from '@/lib/prisma';

const data = await prisma.project.findMany({ where: { status: 'Bid Submitted' } });
```

#### Option B: Comment Out Firebase Code (For Testing)
Quickly unblock the build by commenting out Firebase operations:
```bash
# Replace all firebase/firestore imports with comments
# This allows app to build and work without Firebase-dependent features
```

### Phase 2: API Routes (18 files)

Critical routes in `/src/app/api/`:
1. `scheduling/route.ts` - Uses schedules & activeSchedule
2. `procore/sync-productivity/route.ts` - Uses productivity_logs
3. `admin/cleanup-generic-scopes/route.ts` - Uses projectScopes
4. `importCsv/route.ts` - Uses projects
5. `daySchedule/route.ts` - Uses activeSchedule
6. ... [12 more in FIREBASE_MIGRATION_STATUS.md]

**Approach:** Update each route to use prisma.project/schedule/etc instead of Firebase collections.

### Phase 3: Pages (35+ files)

Pages in `/src/app/`:
- `dashboard/`
- `projects/`
- `scheduling/`
- `short-term-schedule/`
- ... [30+ more]

**Approach:** Replace Firebase getDocs/query calls with prisma.findMany etc.

### Phase 4: Scripts (20+ files)

These are non-critical but should be updated or deleted:
- `scripts/bootstrapCorrect.mjs`
- `scripts/bootstrapSummary.mjs`
- Various debug scripts

**Approach:** Delete or update for Prisma if still needed

## Recommended Implementation Path

### For Quick Unblocking:
1. Use search & replace to comment out all Firebase imports
2. Wrap Firebase-dependent code in try-catch with console errors
3. This lets the app build and work with fallbacks

### For Complete Migration:
Follow the file categories in FIREBASE_MIGRATION_STATUS.md:
1. Start with API routes (most critical)
2. Then main pages
3. Then components
4. Finally, scripts

## Key Prisma Operations

```typescript
import { prisma } from '@/lib/prisma';

// Read
const projects = await prisma.project.findMany();
const project = await prisma.project.findUnique({ where: { id: '123' } });
const filtered = await prisma.project.findMany({ where: { status: 'Estimating' } });

// Create
await prisma.project.create({ data: { projectName: '...' } });

// Update
await prisma.project.update({ where: { id: '123' }, data: { status: 'In Progress' } });

// Delete
await prisma.project.delete({ where: { id: '123' } });

// Batch
await prisma.$transaction([
  prisma.project.create({ data: { projectName: '...' } }),
  prisma.project.update({ where: { id: '...' }, data: { ... } })
]);
```

## Files Ready for Reference

- `/src/app/dashboard/projectQueries.ts` - Fully migrated Prisma example
- `/src/utils/activeScheduleUtils.ts` - Fully migrated Prisma example
- `/src/utils/prismaActiveScheduleUtils.ts` - Additional helpers
- `prisma/schema.prisma` - Complete schema with all models

Use these as templates for migrating other files.

## Database Connection

Your `DATABASE_URL` is configured in `.env.local`:
```
postgres://[key]:sk_p_[secret]@db.prisma.io:5432/postgres?sslmode=require
```

All Prisma client code uses the singleton at `/src/lib/prisma.ts`

## Estimated Effort

- Quick unblocking: 30 minutes (comment out code)
- Complete migration: 4-6 hours (systematic replacement)
- Testing: 1-2 hours

## Commands to Run After Making Changes

```bash
# Build the app
npm run build

# Start dev server
npm run dev

# Run type checks
npx tsc --noEmit
```
