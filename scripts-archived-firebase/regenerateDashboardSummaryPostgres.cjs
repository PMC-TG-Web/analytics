/**
 * regenerateDashboardSummaryPostgres.cjs
 *
 * Rebuilds the DashboardSummary record in Postgres from live project data.
 * Replicates the same deduplication and aggregation logic as calculateAggregated()
 * in src/utils/projectUtils.ts.
 *
 * Run: node scripts-archived-firebase/regenerateDashboardSummaryPostgres.cjs
 */

// Note: PMCGrouping.csv lookup is handled by applyPMCGroupings.cjs (run that first)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ── Status normalisation (mirrors projectUtils.ts normalizeStatus) ─────────
const STATUS_NORMALIZATION = {
  'bid submitted':    'Bid Submitted',
  'bid_submitted':    'Bid Submitted',
  'bidsubmitted':     'Bid Submitted',
  'bidding':          'Bid Submitted',
  'estimating':       'Estimating',
  'in progress':      'In Progress',
  'in_progress':      'In Progress',
  'inprogress':       'In Progress',
  'complete':         'Complete',
  'completed':        'Complete',
  'lost':             'Lost',
  'accepted':         'Accepted',
  'pre-construction': 'Pre-Construction',
  'preconstruction':  'Pre-Construction',
  'to do':            'To Do',
  'to_do':            'To Do',
  'todo':             'To Do',
  'invitations':      'Invitations',
  'invitation':       'Invitations',
};

function normalizeStatus(raw) {
  if (!raw) return 'Unknown';
  const key = raw.toString().toLowerCase().trim();
  return STATUS_NORMALIZATION[key] || raw.toString().trim();
}

// ── Dashboard exclusion logic (mirrors isExcludedFromDashboard) ────────────
const EXCLUDED_STATUSES = new Set(['invitations', 'to do', 'todo', 'to-do', 'unknown']);

function isExcluded(p) {
  if (p.projectArchived) return true;
  const status = (p.status || '').toLowerCase().trim();
  if (EXCLUDED_STATUSES.has(status)) return true;
  const customer = (p.customer || '').toLowerCase();
  if (customer.includes('sop inc')) return true;
  const name = (p.projectName || '').toLowerCase();
  if (['pmc operations', 'pmc shop time', 'pmc test project'].includes(name)) return true;
  if (name.includes('sandbox') || name.includes('raymond king')) return true;
  const num = (p.projectNumber || '').toLowerCase();
  if (num === '701 poplar church rd') return true;
  return false;
}

// ── Parse date value ───────────────────────────────────────────────────────
function getProjectDate(p) {
  const year = p.dateUpdated
    ? new Date(p.dateUpdated).getFullYear()
    : (p.dateCreated ? new Date(p.dateCreated).getFullYear() : 0);

  if (year >= 2026 && p.dateUpdated) return new Date(p.dateUpdated);
  if (p.dateCreated) return new Date(p.dateCreated);
  if (p.dateUpdated) return new Date(p.dateUpdated);
  return null;
}

// ── Merge pmcGroup objects from multiple rows ──────────────────────────────
function mergePmcGroups(rows) {
  const merged = {};
  let hasAny = false;
  for (const p of rows) {
    const cf = p.customFields || {};
    const pmg = cf.pmcGroup;
    if (pmg && typeof pmg === 'object' && !Array.isArray(pmg)) {
      hasAny = true;
      for (const [cat, hrs] of Object.entries(pmg)) {
        const h = Number(hrs) || 0;
        if (h > 0) merged[cat] = (merged[cat] || 0) + h;
      }
    }
  }
  return hasAny ? merged : null;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching all projects from database...');

  const raw = await prisma.project.findMany({
    select: {
      id: true,
      projectName: true,
      customer: true,
      status: true,
      sales: true,
      cost: true,
      hours: true,
      laborSales: true,
      laborCost: true,
      dateCreated: true,
      dateUpdated: true,
      projectArchived: true,
      estimator: true,
      projectManager: true,
      customFields: true,
      projectNumber: true,
    },
  });
  console.log(`  ${raw.length} total projects`);

  // Normalise status + filter excluded
  const projects = raw
    .map(p => ({ ...p, status: normalizeStatus(p.status) }))
    .filter(p => !isExcluded(p));
  console.log(`  ${projects.length} after normalisation and exclusion`);

  // ── Step 1: Dedup by project name → select best customer group ────────────
  const byName = new Map();
  for (const p of projects) {
    const key = (p.projectName || '').toString().trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(p);
  }

  const PRIORITY_STATUSES = new Set(['accepted', 'in progress']);
  const dedupedByCustomer = [];

  byName.forEach((nameRows) => {
    // Group by customer
    const byCustomer = new Map();
    for (const p of nameRows) {
      const cKey = (p.customer || '').toLowerCase().trim();
      if (!byCustomer.has(cKey)) byCustomer.set(cKey, []);
      byCustomer.get(cKey).push(p);
    }

    // Score each customer group
    const groups = Array.from(byCustomer.entries()).map(([cKey, rows]) => {
      const hasPriority = rows.some(r => PRIORITY_STATUSES.has(r.status.toLowerCase()));
      let latestDate = null;
      for (const r of rows) {
        const d = getProjectDate(r);
        if (d && (!latestDate || d > latestDate)) latestDate = d;
      }
      return { cKey, display: (rows[0].customer || '').trim(), rows, hasPriority, latestDate };
    });

    const priority = groups.filter(g => g.hasPriority);
    const candidates = priority.length > 0 ? priority : groups;
    candidates.sort((a, b) => {
      const ta = a.latestDate ? a.latestDate.getTime() : -Infinity;
      const tb = b.latestDate ? b.latestDate.getTime() : -Infinity;
      if (ta !== tb) return tb - ta;
      return a.display.localeCompare(b.display);
    });

    const selected = candidates[0];
    if (selected) dedupedByCustomer.push(...selected.rows);
  });

  console.log(`  ${dedupedByCustomer.length} rows after customer dedup`);

  // ── Step 2: Aggregate rows with same customer||projectName ────────────────
  const byKey = new Map();
  for (const p of dedupedByCustomer) {
    const cust = (p.customer || '').toLowerCase().trim();
    const name = (p.projectName || '').toLowerCase().trim();
    if (!cust || !name) continue;
    const key = `${cust}||${name}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }

  const aggregated = [];
  byKey.forEach((rows) => {
    const base = { ...rows[0] };
    base.sales  = rows.reduce((s, p) => s + (Number(p.sales)      || 0), 0);
    base.cost   = rows.reduce((s, p) => s + (Number(p.cost)       || 0), 0);
    base.hours  = rows.reduce((s, p) => s + (Number(p.hours)      || 0), 0);
    base.laborSales = rows.reduce((s, p) => s + (Number(p.laborSales) || 0), 0);
    base.laborCost  = rows.reduce((s, p) => s + (Number(p.laborCost)  || 0), 0);

    // Merge pmcGroup from all rows
    const merged = mergePmcGroups(rows);
    base._mergedPmcGroup = merged; // temp field for step 3

    // Keep most recent date
    const mostRecent = rows.reduce((latest, r) => {
      const d = getProjectDate(r);
      const ld = getProjectDate(latest);
      if (!d) return latest;
      if (!ld) return r;
      return d > ld ? r : latest;
    }, rows[0]);
    base.dateUpdated = mostRecent.dateUpdated;
    base.dateCreated = mostRecent.dateCreated;

    aggregated.push(base);
  });

  console.log(`  ${aggregated.length} unique aggregated projects`);

  // ── Step 3: Build statusGroups ─────────────────────────────────────────────
  const statusGroups = {};

  for (const p of aggregated) {
    const status = p.status || 'Unknown';
    if (!statusGroups[status]) {
      statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0, laborByGroup: {} };
    }
    const sg = statusGroups[status];
    sg.sales  += Number(p.sales)  || 0;
    sg.cost   += Number(p.cost)   || 0;
    sg.hours  += Number(p.hours)  || 0;
    sg.count  += 1;

    // Populate laborByGroup from merged pmcGroup
    const pmg = p._mergedPmcGroup;
    if (pmg) {
      for (const [group, hrs] of Object.entries(pmg)) {
        const h = Number(hrs) || 0;
        if (h <= 0) continue;
        // Normalise: "Management" → "PM"
        const normGroup = group.toLowerCase() === 'management' ? 'PM' : group;
        sg.laborByGroup[normGroup] = (sg.laborByGroup[normGroup] || 0) + h;
      }
    }
    // Hours without a pmcGroup go into "Unassigned" so totals are accurate
    else {
      const h = Number(p.hours) || 0;
      if (h > 0) {
        sg.laborByGroup['Unassigned'] = (sg.laborByGroup['Unassigned'] || 0) + h;
      }
    }
  }

  // ── Step 4: Build contractors ──────────────────────────────────────────────
  const contractors = {};
  for (const p of aggregated) {
    const customer = p.customer || 'Unknown';
    const status   = p.status   || 'Unknown';
    const sales  = Number(p.sales)  || 0;
    const cost   = Number(p.cost)   || 0;
    const hours  = Number(p.hours)  || 0;

    if (!contractors[customer]) {
      contractors[customer] = { sales: 0, cost: 0, hours: 0, count: 0, byStatus: {} };
    }
    const c = contractors[customer];
    c.sales  += sales;
    c.cost   += cost;
    c.hours  += hours;
    c.count  += 1;

    if (!c.byStatus[status]) {
      c.byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
    }
    c.byStatus[status].sales  += sales;
    c.byStatus[status].cost   += cost;
    c.byStatus[status].hours  += hours;
    c.byStatus[status].count  += 1;
  }

  // ── Step 5: Build pmcGroupHours (PM-named groups from Bid Submitted only) ──
  const pmcGroupHours = {};
  const bidLabor = (statusGroups['Bid Submitted'] || {}).laborByGroup || {};
  for (const [group, hrs] of Object.entries(bidLabor)) {
    const norm = group.toLowerCase().trim();
    if (norm === 'pm' || norm.startsWith('pm ')) {
      pmcGroupHours[group] = (pmcGroupHours[group] || 0) + Number(hrs);
    }
  }

  // ── Step 6: Totals ─────────────────────────────────────────────────────────
  const totalSales = aggregated.reduce((s, p) => s + (Number(p.sales) || 0), 0);
  const totalCost  = aggregated.reduce((s, p) => s + (Number(p.cost)  || 0), 0);
  const totalHours = aggregated.reduce((s, p) => s + (Number(p.hours) || 0), 0);

  // ── Diagnostics ────────────────────────────────────────────────────────────
  console.log('\n--- Diagnostics ---');
  for (const [status, sg] of Object.entries(statusGroups)) {
    const labKeys = Object.keys(sg.laborByGroup);
    const labHours = Object.values(sg.laborByGroup).reduce((s, h) => s + h, 0);
    console.log(`  [${status}] ${sg.count} projects / $${Math.round(sg.sales).toLocaleString()} / ${Math.round(sg.hours)} hrs`);
    if (labKeys.length) {
      console.log(`    laborByGroup keys: ${labKeys.join(', ')}`);
      console.log(`    laborByGroup total hrs: ${Math.round(labHours)}`);
    }
  }
  console.log(`\n  Totals: $${Math.round(totalSales).toLocaleString()} sales, ${Math.round(totalHours)} hrs`);
  console.log(`  PM hours (Bid Submitted): ${JSON.stringify(pmcGroupHours)}`);

  // ── Step 7: Upsert DashboardSummary ───────────────────────────────────────
  console.log('\nSaving DashboardSummary to database...');

  // Remove temp fields before saving
  for (const p of aggregated) delete p._mergedPmcGroup;

  await prisma.dashboardSummary.upsert({
    where: { id: 'summary' },
    update: {
      totalSales,
      totalCost,
      totalHours,
      statusGroups,
      contractors,
      pmcGroupHours,
    },
    create: {
      id: 'summary',
      totalSales,
      totalCost,
      totalHours,
      statusGroups,
      contractors,
      pmcGroupHours,
    },
  });

  console.log('DashboardSummary saved successfully!');
}

main()
  .catch(e => { console.error('Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
