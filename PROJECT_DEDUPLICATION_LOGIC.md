# Project Deduplication Logic

## Overview
When multiple contractors/customers bid on the same project (identified by `projectName`), this logic determines which customer's entry to keep during deduplication.

## Selection Priority (in order)

### 1. **Status Preference** (Highest Priority)
- **Accepted** or **In Progress** status is preferred
- If any entry has these statuses, only those are considered for selection
- If none have these statuses, all entries are candidates for the next priority

### 2. **dateUpdated** (Second Priority)
- The most recently **updated** entry is selected
- Used to identify which customer's submission was most recently worked on/modified
- Only used if dateUpdated exists

### 3. **dateCreated** (Third Priority - Fallback)
- If dateUpdated is missing or all entries have the same dateUpdated
- The most recently **created** entry is selected
- Acts as fallback when update date is not available

### 4. **Customer Name** (Final Tiebreaker)
- If all previous priorities are tied (same status, dateUpdated, dateCreated)
- Sort customers alphabetically and select the first one
- Ensures consistent, reproducible results

## Example Scenarios

### Scenario 1: Different Status
```
Project: "Cozy Cabins"
- Hoover Building: Status = "Bid Submitted", dateUpdated = Dec 2, 2025
- Brecknock Builders: Status = "Bid Submitted", dateUpdated = Jan 12, 2026

Decision: Brecknock Builders selected (most recent dateUpdated)
```

### Scenario 2: Preferred Status
```
Project: "Alexander Drive Addition"
- Scenic Ridge: Status = "In Progress", dateUpdated = Jan 20, 2026
- (blank): Status = "Estimating", dateUpdated = Jan 15, 2026

Decision: Scenic Ridge selected ("In Progress" is preferred status)
```

### Scenario 3: Alphabetical Tiebreaker
```
Project: "ACTS Lower Gwynedd - Oakbridge Terrace"
- Warfel Construction: Status = "Bid Submitted", dateUpdated = Dec 3, 2025
- Wohlsen Construction: Status = "Bid Submitted", dateUpdated = Dec 2, 2025

Decision: Warfel Construction selected (more recent dateUpdated)
```

## Implementation Usage

### In Node.js/Prisma Scripts
```javascript
import { deduplicateProjects, selectBestProjectEntry } from './utils/projectDeduplication.mjs';

// Deduplicate a list of projects
const projects = [...]; // from database or CSV
const result = deduplicateProjects(projects);

console.log(`
  Original: ${result.originalCount}
  Deduplicated: ${result.deduplicatedCount}
  Removed: ${result.duplicatesRemoved}
`);

// Or select a single entry when you have multiple candidates
const candidates = [...]; // multiple entries for same projectName
const selected = selectBestProjectEntry(candidates);
```

### In SQL/Database Queries
When applying this logic in SQL, the priority order translates to:
```sql
ORDER BY 
  CASE WHEN status IN ('Accepted', 'In Progress') THEN 0 ELSE 1 END,
  dateUpdated DESC NULLS LAST,
  dateCreated DESC NULLS LAST,
  customer ASC
LIMIT 1
```

## Database Fields Required
- `projectName` - Name of the project (grouping key)
- `customer` - Name of the customer/contractor (tiebreaker)
- `status` - Project status (Accepted, In Progress, Bid Submitted, Lost, etc.)
- `dateUpdated` - Date when the project entry was last updated
- `dateCreated` - Date when the project entry was created

## Fields with Missing Values
- If `dateUpdated` is NULL, the logic falls back to `dateCreated`
- If `dateCreated` is also NULL, it's treated as `new Date(0)` (earliest)
- If `customer` is blank/null, it's treated as empty string in alphabetical sort

## Current Implementation Status
✅ **Active** - This logic is currently implemented in:
- `deduplicate-from-db.mjs` - Main deduplication script
- `export-deduplicated-csv.mjs` - CSV export with deduplication
- `list-chosen-customers.mjs` - Customer selection list generator
- `list-deduplicated-projects.mjs` - Full project list with selections

## Results Summary
**As of 2026-03-02:**
- Total projects: 335
- Deduplicated projects: 307
- Duplicates removed: 28
- Total hours: 405,092.69

### Duplicated Projects (26 entries):
1. ACTS Lower Gwynedd - Oakbridge Terrace → **Warfel Construction**
2. Alexander Drive Addition → **Scenic Ridge Construction**
3. Complete Recycling Group → **Wynstride**
4. Cozy Cabins → **Hoover Building Specialists, Inc.**
5. Cozy Cabins Shed → **Hoover Building Specialists, Inc.**
... (and 21 more)

See `duplicated-projects-only.csv` for complete list.
