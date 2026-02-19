# Procore API Projects Endpoint Comparison

## Overview
The user is investigating the `/rest/v1.0/projects` endpoint to understand how it compares to the v1.1 endpoint we're currently using.

## Key Findings from Postman Collection

### v1.1 Endpoint (Currently Used)
**Path**: `/rest/v1.1/projects`
**Method**: GET
**Description**: Return a list of active Projects
**Parameters**:
- `company_id` (required)
- `view` (optional): "compact", "normal" (default), "extended"
- `per_page` (default: 100, max: 300)
- `page`
- `filters[active]` (optional): Filter by active status
- `sort`

**Key Notes**:
- Default pagination: 100 projects per page
- Max page size: 300 projects
- Returns **only active projects** by default
- User's access depends on permissions:
  - Full company admin: sees all projects
  - Limited admin: sees only projects they've been added to

---

### v1.0 Endpoint
**Path**: `/rest/v1.0/projects`
**Method**: GET
**Description**: Return a list of active Projects
**Parameters**:
- `company_id` (required via `Procore-Company-Id` header)
- `view` (optional): "compact", "normal", "extended"
- `page`
- `per_page`
- `filters[active]` (optional)
- `sort`

**Response**:
- Same structure as v1.1
- Also returns only **active projects** by default

**Key Differences from v1.1**:
1. **API version**: v1.0 (older, but may have different default behavior)
2. **Return size**: Default 100 projects per page (same as v1.1)
3. **Max page size**: 300 projects (same as v1.1)
4. **Active filter**: Both default to active projects only
5. **Legacy endpoint**: v1.0 is older and may be deprecated in newer Procore versions

---

## Problem Analysis

### Why Only 133 Projects? - ROOT CAUSE IDENTIFIED
**Both v1.0 AND v1.1 explicitly return ONLY active projects by default.**

Documentation from Postman collection:
```
"Return a list of active Projects."
```

The 133 projects we see are:
- **v2.0 bid board**: Only active estimating/bidding projects (133 total)
- **v1.0 projects**: Only **active** projects (132-134 range)
- **v1.1 projects**: Only **active** projects (132-134 range)

### What's Missing (167 projects)?
To get the remaining ~167 projects, we need to:
1. ✅ **CONFIRMED**: Filter parameter exists for active projects
   - `filters[active]` parameter available (boolean type)
   - Procore docs reference standard "Filtering on List Actions" framework
   - **Need to test**: `filters[active]=false` for inactive, or find "include all" value

2. **Alternative approaches**:
   - Check if there's a `filters[status]` that accepts multiple values
   - Look for separate "portfolio projects" endpoint
   - Check if `view=extended` returns inactive projects
   - Contact Procore support for "include completed/archived projects" filter syntax

### Critical Discovery
The Postman collection documentation **explicitly states** "active Projects" not "all projects", confirming this is by-design API behavior, not a bug in our code.

---

## Next Steps to Investigate

### Priority 1: Test Filter Values (CRITICAL)
Need to test the `/rest/v1.1/projects` endpoint with different filter combinations to include inactive/completed projects:

```bash
# Test 1: Request only inactive projects
GET /rest/v1.1/projects?company_id=598134325658789&filters[active]=false&per_page=300&page=1

# Test 2: Request all projects (if any/null works to override default)
GET /rest/v1.1/projects?company_id=598134325658789&filters[active]=any&per_page=300&page=1

# Test 3: Omit active filter entirely (maybe default behavior will change)
GET /rest/v1.1/projects?company_id=598134325658789&per_page=300&page=1

# Test 4: Try multiple values if status filter exists
GET /rest/v1.1/projects?company_id=598134325658789&filters[status]=completed&per_page=300&page=1
```

**Success Criteria**: If any test returns more than 200 projects, we found the solution.

### Priority 2: Check User Permissions & Access
The issue may be permission-related, not filter-related:

- **Check if authenticated user is company admin**:
  - Admin users: See ALL projects (active + inactive)
  - Non-admins: See only assigned projects
  
- **Your CSV shows 300 total** but API returns 133 → user may have export permissions but not API admin role

- **Test solution**: Request Procore admin account or check user role in settings

### Priority 3: Alternative Data Sources (If filtering fails)
If `filters[active]` doesn't work, explore:

1. **Separate "Portfolio" Endpoint**: Procore may have `portfolio/projects` endpoint
2. **Project Status Field**: Responses may include `status` field with values like:
   - `active`, `complete`, `lost`, `archived`, `cancelled`
3. **Listing Inactive by Page Count**: If you see fewer than 300 on page 1, you're seeing all available

### Priority 4: Hybrid Approach (Fallback)
If no single endpoint has all 300:
- Keep v1.1 active projects (133)
- Make separate call with `filters[active]=false` for inactive (167)
- Merge both lists with deduplication
- Total: 300 projects

---

## Code Location
Current implementation: [src/app/api/procore/projects/route.ts](src/app/api/procore/projects/route.ts)

Current approach:
- Using v1.1 as primary source (assumed ~300 projects)
- Using v2.0 bid board as enrichment
- But only getting 133 projects total because v1.1 also filters to active only

---

## Recommendation

### Current Blocker
**All three Procore APIs limit responses to active projects only:**
- **v1.0**: Explicitly returns "active Projects" only
- **v1.1**: Explicitly returns "active Projects" only  
- **v2.0 Bid Board**: Returns only estimating/bidding projects (even more filtered)

### Why This Matters
Your company has ~300 total projects but:
- CSV export: 300 projects ✅ (includes all statuses)
- API responses: 133 projects ❌ (active only)
- Missing: ~167 projects (completed, lost, archived)

### Solution Path (In Priority Order)

1. **MOST LIKELY FIX** (10 min test):
   - Test: `GET /rest/v1.1/projects?filters[active]=false`
   - This should return inactive/completed projects
   - If it returns 167+ projects → **Problem solved**

2. **IF #1 FAILS** (20 min investigation):
   - Check if user account has company-wide admin permissions
   - Non-admin users only see assigned projects (67/133 each?)
   - Need to request higher permission level or different API token

3. **IF #2 FAILS** (30 min):
   - Implement hybrid solution: Query active AND inactive separately
   - Merge results with `List.concat()` on v1.1 endpoint
   - Ensures all 300 projects are discoverable

### Implementation Impact
Once solution is found, update [src/app/api/procore/projects/route.ts](src/app/api/procore/projects/route.ts):
- Add filter parameter to both v1.1 API calls
- Or modify to query inactive projects separately
- Update console logging to show new project count
