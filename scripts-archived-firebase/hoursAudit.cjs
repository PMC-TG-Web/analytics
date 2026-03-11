/**
 * hoursAudit.cjs
 * Builds a PMCGroup × Status pivot table from DB projects (mirrors the user's spreadsheet)
 * so we can compare exactly where the discrepancies are.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    select: { projectName: true, customer: true, status: true, hours: true, customFields: true },
  });

  console.log(`Total DB rows: ${projects.length}`);

  const pivot = {}; // pmcGroup → status → hours
  let totalLineItemHours = 0;
  let totalRawHours = 0;
  let projectsWithLineItems = 0;
  let projectsWithoutLineItems = 0;

  for (const p of projects) {
    const status = (p.status || 'Unknown').trim();
    const cf = p.customFields || {};

    if (Array.isArray(cf.lineItems) && cf.lineItems.length > 0) {
      projectsWithLineItems++;
      // Sum from lineItems via pmcGroup breakdown
      const pmg = cf.pmcGroup;
      if (pmg && typeof pmg === 'object') {
        for (const [group, hrs] of Object.entries(pmg)) {
          const h = Number(hrs) || 0;
          if (!pivot[group]) pivot[group] = {};
          pivot[group][status] = (pivot[group][status] || 0) + h;
          totalLineItemHours += h;
        }
      } else {
        // Has lineItems but pmcGroup not yet computed
        const h = Number(p.hours) || 0;
        if (!pivot['#N/A']) pivot['#N/A'] = {};
        pivot['#N/A'][status] = (pivot['#N/A'][status] || 0) + h;
      }
    } else {
      projectsWithoutLineItems++;
      // CSV-imported — only has total hours, no breakdown
      const h = Number(p.hours) || 0;
      if (!pivot['#N/A']) pivot['#N/A'] = {};
      pivot['#N/A'][status] = (pivot['#N/A'][status] || 0) + h;
      totalRawHours += h;
    }
  }

  // Collect all statuses
  const allStatuses = new Set();
  for (const groups of Object.values(pivot)) {
    for (const s of Object.keys(groups)) allStatuses.add(s);
  }
  const statuses = Array.from(allStatuses).sort();

  // Print header
  const cols = ['PMCGroup', ...statuses, 'Row Total'];
  console.log('\n' + cols.join('\t'));

  const statusTotals = {};
  let grandTotal = 0;

  // Print rows sorted by group name
  const sortedGroups = Object.keys(pivot).sort();
  for (const group of sortedGroups) {
    const row = [group];
    let rowTotal = 0;
    for (const s of statuses) {
      const h = Math.round(pivot[group][s] || 0);
      row.push(h || '');
      statusTotals[s] = (statusTotals[s] || 0) + h;
      rowTotal += h;
      grandTotal += h;
    }
    row.push(rowTotal);
    console.log(row.join('\t'));
  }

  // Grand total row
  const totalRow = ['Grand Total'];
  for (const s of statuses) totalRow.push(Math.round(statusTotals[s] || 0));
  totalRow.push(grandTotal);
  console.log(totalRow.join('\t'));

  console.log(`\n--- Summary ---`);
  console.log(`Projects with lineItems (detailed breakdown): ${projectsWithLineItems}`);
  console.log(`Projects without lineItems (CSV-imported):    ${projectsWithoutLineItems}`);
  console.log(`Hours from pmcGroup breakdowns: ${Math.round(totalLineItemHours)}`);
  console.log(`Hours from raw total (no breakdown): ${Math.round(totalRawHours)}`);

  // Per-status totals
  console.log(`\n--- Hours by Status (raw project.hours field) ---`);
  const byStatus = {};
  for (const p of projects) {
    const s = (p.status || 'Unknown').trim();
    byStatus[s] = (byStatus[s] || 0) + (Number(p.hours) || 0);
  }
  let dbTotal = 0;
  for (const [s, h] of Object.entries(byStatus).sort()) {
    console.log(`  ${s}: ${Math.round(h).toLocaleString()}`);
    dbTotal += h;
  }
  console.log(`  TOTAL: ${Math.round(dbTotal).toLocaleString()}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
