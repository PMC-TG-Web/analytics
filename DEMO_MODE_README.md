# Demo Mode - Temporary Firebase Fallback

## What Happened

Your Firebase project has been suspended by Google. While waiting for the appeal to be approved, the app is now running in **Demo Mode** with sample data.

---

## Demo Data Included

The demo includes 8 sample projects with realistic data:

| Project | Customer | Status | Hours | Sales |
|---------|----------|--------|-------|-------|
| Giant #6582 | Ames Construction | In Progress | 450 | $125,000 |
| Washburn Dam | Washburn Solutions | Bid Submitted | 320 | $89,500 |
| Kemper Phase 2 | Kemper Construction | Accepted | 680 | $225,000 |
| Goods Store QV | Goods Store Inc | Complete | 290 | $78,900 |
| UGI Remediation | UGI Utilities | In Progress | 520 | $156,000 |
| Memorial Care 3A | Memorial Care | Bid Submitted | 610 | $198,500 |
| AB Martin | AB Martin Inc | Accepted | 380 | $95,000 |
| Stevens Feed Mill | Stevens Farm Supply | In Progress | 510 | $142,000 |

**Total in Demo:**
- 4 projects (3,840 hours)
- $1,109,900 in sales
- Multi-status display system test

---

## How It Works

The app uses a **Firebase Adapter** layer that:

1. **Tries real Firebase first** - If the project is restored, it automatically switches
2. **Falls back to demo data** - If Firebase is down, provides sample data
3. **Shows a banner** - Yellow warning banner at top indicates demo mode
4. **Is transparent** - No code changes needed elsewhere

**Key files:**
- `src/lib/mockFirestore.ts` - Demo data definitions
- `src/lib/firebaseAdapter.ts` - Automatic fallback logic
- `src/components/MockDataBanner.tsx` - Status indicator
- `src/app/dashboard/projectQueries.ts` - Updated to use adapter

---

## What to Expect

### Dashboard
- ✅ Displays all 8 sample projects
- ✅ Shows summary cards with totals
- ✅ Status distribution working
- ✅ Contractor analysis working
- ✅ Clicking projects shows details (demo data only)

### Schedule Pages
- ⚠️ May show limited or no data (uses separate Firebase collections)
- Demo data is focused on dashboard/projects

### Other Features
- ✅ Navigation working
- ✅ Authentication still required
- ⚠️ Any edits won't persist (read-only demo)

---

## When Firebase is Restored

### Automatic Switchover
No code changes needed. When your Firebase project is restored:

1. **Yellow banner disappears** - App detects real Firebase is online
2. **Real data loads immediately** - Your actual project data appears
3. **Demo data fades away** - Happens transparently

### What You Should Do

1. **Monitor Google Cloud support ticket** - Wait for suspension to be lifted
2. **Run verification script when restored:**
   ```bash
   node scripts/verifyFirebaseConnection.mjs
   ```
3. **If data doesn't load:**
   - Run bootstrap script:
     ```bash
     node scripts/bootstrapSummary-AdminSDK.mjs
     ```

---

## For Your Meeting

You now have:
- ✅ Working dashboard with demo data
- ✅ Can show project listing, summaries, trends
- ✅ Can demonstrate filtering and drill-through
- ✅ Real data structure, just with sample projects

The demo data is realistic enough for a stakeholder demo or test environment validation.

---

## Limitations

Demo mode is **read-only**. You cannot:
- ❌ Edit project details
- ❌ Create new projects
- ❌ Update schedules
- ❌ Save changes

All edits would fail or be silently ignored. This is expected behavior while Firebase is down.

---

## After Firebase is Restored

Once Google approves your appeal and restores the project:

1. The yellow banner will automatically disappear
2. Your real data will start loading
3. All write operations will work again
4. The demo data will never be used again

No manual configuration needed - the adapter handles the switch automatically.

---

## Technical Notes

- **Pagination**: Demo uses in-memory data (no pagination needed)
- **Real Firebase**: Updated scripts use pagination + 500ms delays
- **Performance**: Demo is snappy; real Firebase may be slightly slower due to safety delays
- **Storage**: Demo data is NOT persisted anywhere

---

## Questions?

See `FIREBASE_RECOVERY_PLAN.md` for the full recovery plan.
