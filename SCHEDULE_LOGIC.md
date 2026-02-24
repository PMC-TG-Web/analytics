# Schedule System Logic & Data Flow

## Overview
The analytics platform uses a multi-level scheduling system with three main views (Long-term, Project Gantt, Short-term) that all pull from shared Firestore collections, with specific priority rules determining which data source takes precedence.

---

## Firestore Collections (Data Sources)

### 1. **schedules** (Primary Source of Truth)
- **Purpose:** Centralized allocation storage with monthly percentages
- **Structure:**
  ```
  {
    jobKey: "Customer~ProjectNumber~ProjectName",
    projectName: "Project Name",
    projectNumber: "2508 - CP",
    customer: "Customer Name",
    totalHours: 531,
    status: "In Progress",
    allocations: {
      "2026-03": 50,      // 50% for March
      "2026-04": 75,      // 75% for April
      "2026-05": 0
    }
  }
  ```
- **Usage:** NEW standard - set in Scheduling page, used by all three schedule views
- **Data Flow:** User enters allocation % → Saving to schedules collection → All views read it

### 2. **projectScopes** (Explicit Scope Definitions)
- **Purpose:** Define specific project scopes with exact start/end dates and work details
- **Structure:**
  ```
  {
    jobKey: "...",
    scopeOfWork: "Foundation Work",
    startDate: "2026-02-24",
    endDate: "2026-03-15",
    manpower: 2,              // 2 people = 20 hours/day
    hours: 400,               // OR fallback total if no manpower
    title: "Dig & Pour Foundation"
  }
  ```
- **Usage:** SHORT-TERM schedule processes these FIRST if dates overlap 5-week window
- **Priority:** Highest - scopes override long-term & schedules collection data

### 3. **long term schedual** (Legacy Monthly Data)
- **Purpose:** Historical month-based schedule (older system)
- **Structure:**
  ```
  {
    jobKey: "...",
    projectName: "...",
    month: "2026-02",
    weeks: [
      {
        weekNumber: 1,
        hours: 40,         // Total hours for that week
        startDate: "2026-02-01"
      }
    ]
  }
  ```
- **Usage:** Fallback source when scopes unavailable
- **Priority:** Medium - used by all three views if no scopes, but skipped if projects in short-term schedual

### 4. **short term schedual** (Daily Assignments)
- **Purpose:** Track which foreman assigned to which project on which day
- **Structure:**
  ```
  {
    jobKey_month: "2508_CP_2026_02",  // Composite ID
    jobKey: "...",
    projectName: "...",
    month: "2026-02",
    weeks: [
      {
        weekNumber: 1,
        days: [
          {
            dayNumber: 1,      // Monday = 1
            hours: 8,          // Actual hours assigned
            foreman: "emp123"  // Foreman ID
          }
        ]
      }
    ]
  }
  ```
- **Usage:** SHORT-TERM schedule uses this to show foreman assignments
- **Priority:** HIGHEST for foreman display (overrides all other sources for foreman field)

---

## The Three Schedule Views

### 1. **Long-Term Schedule** (15-week view)
**File:** `src/app/long-term-schedule/page.tsx`

**Data Loading Priority:**
1. Scopes from `projectScopes` (if startDate/endDate within 15-week window)
2. Long-term schedual from `long term schedual` collection
3. Monthly allocations from `schedules` collection
   - Distributes monthly % across Mondays in month
   - Calculates: `monthHours = totalHours × percent / 100`
   - Splits evenly: `hoursPerWeek = monthHours / validMondays`
   - Then: `hoursPerDay = hoursPerWeek / 5`

**Output:** Project cards grouped by week showing total hours

---

### 2. **Project Schedule (Gantt Chart)** (Monthly project view)
**File:** `src/app/project-schedule/hooks/useProjectSchedule.ts`

**Data Loading Priority:**
1. Scopes from `projectScopes` (creates timeline entries)
2. Short-term schedual data (for daily details)
3. Long-term schedual (for month-level data)
4. Monthly allocations from `schedules` collection

**Output:** Gantt-style timeline showing project duration and monthly breakdown

---

### 3. **Short-Term Schedule** (5-week daily view with crew assignment)
**File:** `src/app/short-term-schedule/page.tsx`

**Data Loading Priority:**
1. **Scopes** from `projectScopes`
   - IF scope.startDate ≤ date < scope.endDate AND within 5-week window
   - Calculates: manpower × 10 hours/day OR total hours distributed
   - Marked as "has data in window" → prevents duplicate loading

2. **Long-term schedual** (only if NOT in scopes)
   - IF project.month within 5-week window
   - IF NOT already processed from scopes
   - Extracts weekly hours, divides by 5 for daily hours

3. **Monthly allocations** from `schedules` collection (if NOT in '1' or '2')
   - IF month overlaps 5-week window AND allocation % > 0
   - Finds Mondays in month within window
   - Calculates: `monthHours = totalHours × percent / 100`
   - Distributes: `hoursPerDay = monthHours / (validMondays × 5)`
   - **NEW:** Only skips if project actually contributed data in this window

4. **Foreman assignments** from `short term schedual`
   - Overlays on top of all above
   - Shows which foreman assigned
   - Allows clicking X to remove foreman assignment (moves to Unassigned)

**Output:** Daily grid showing projects, hours, and assigned foreman

---

## Data Priority Matrix

| Scenario | Winners | Losers |
|----------|---------|--------|
| Project has scopes with dates in window | Scopes | Long-term, Schedules |
| Project scopes exist but dates outside window | Schedules OR Long-term | Scopes (irrelevant) |
| Project in schedules collection only | Schedules | Long-term |
| Project in long-term schedual collection | Long-term | — |
| Foreman assigned in short-term | Short-term foreman overlay | (adds on top) |
| Project with no data in 5-week window | Not displayed | — |

---

## Case Study: Canine Partners

**Current Setup:**
- `schedules` collection: 531 total hours, 50% for 2026-03
- No scopes defined
- No long-term schedual data for March
- Short-term schedual: empty initially, foreman added later

**Flow for Short-Term Schedule (Feb 24 - Mar 30):**
1. ✅ Check scopes → No scopes or scopes outside window
2. ✅ Check long-term schedual → No March data
3. ✅ Check schedules collection → Found! 2026-03: 50%
   - Calculate: 531 × 50% = 265.5 hours for March
   - Find Mondays in March within 5-week window: Mar 02, 09, 16, 23 (4 weeks)
   - Per week: 265.5 / 4 = 66.375 hours
   - Per day: 66.375 / 5 = 13.275 hours/day
4. ✅ Display Canine Partners in early March weeks at ~13 hours/day
5. ✅ If foreman assigned via short-term schedual → Show foreman name overlay

**Result:** Canine Partners appears March 2-23 with correct hours distribution

---

## Key Rules

### Rule 1: Window-Based Filtering
- Long-term: 15 weeks
- Short-term: 5 weeks
- Only projects with data in window are displayed

### Rule 2: Deduplication Priority
- Once a project gets data from scopes within the window, it's marked "done"
- Prevents loading same project multiple times
- **Exception:** Projects are only marked "done" if they actual contribute data
  - Empty scopes outside window don't mark it done
  - This allows schedules collection to pick up data

### Rule 3: Foreman Assignment Overlay
- Foreman data from short-term schedual always takes display priority
- Shows on top of hours from any source
- Clicking X removes foreman assignment (clears document entry)
- Project stays visible with hours from original source

### Rule 4: Monthly Percentage Distribution
- Percentages only apply to `schedules` collection
- Spread evenly across valid Mondays in month
- Each day gets: `totalHours × percent / 100 / numMondays / 5`

---

## Data Consistency

All three views now use these sources (with same priority):
```
Scopes (if in window) 
  ↓ (if not scopes)
Long-term schedual  
  ↓ (if not scopes or long-term)
Schedules collection (monthly %)
```

This ensures:
- ✅ Same project shows same hours on all three views (if in same date window)
- ✅ New allocations to schedules collection immediately appear everywhere
- ✅ Older long-term schedual data acts as fallback
- ✅ Scopes provide explicit control when needed

---

## Updates & Modifications

### When User Updates Scheduling Page:
1. Saves to `schedules` collection
2. Next page load automatically reads updated allocations
3. All three schedule views display new data

### When User Assigns Foreman (Short-term):
1. Saves to `short term schedual` collection
2. Foreman name appears next to project
3. Hours from underlying source unchanged

### When User Clicks X (Remove Foreman):
1. Deletes entry from `short term schedual` collection  
2. Foreman assignment cleared
3. Project stays visible with original hours

