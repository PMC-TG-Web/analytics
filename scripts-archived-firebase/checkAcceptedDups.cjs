/**
 * checkAcceptedDups.cjs - Find all project name groups that contain an Accepted row
 * to detect where the regen script is over-counting
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.project.findMany({
    select: { projectName: true, customer: true, status: true, hours: true, customFields: true },
    orderBy: { projectName: 'asc' },
  });

  // Group by projectName
  const byName = {};
  for (const r of rows) {
    const k = (r.projectName || '').toLowerCase().trim();
    if (!byName[k]) byName[k] = [];
    byName[k].push(r);
  }

  let totalAcceptedAfterDedup = 0;

  for (const [, list] of Object.entries(byName)) {
    const hasAccepted = list.some(r => (r.status || '') === 'Accepted');
    if (!hasAccepted) continue;

    console.log(`\nPROJECT: ${list[0].projectName} (${list.length} rows)`);

    // Simulate the regen dedup: pick Accepted/In Progress customer group
    const byCustomer = {};
    for (const r of list) {
      const ck = (r.customer || '').toLowerCase().trim();
      if (!byCustomer[ck]) byCustomer[ck] = [];
      byCustomer[ck].push(r);
    }

    // Find the winning customer group
    let winningGroup = null;
    for (const [, crows] of Object.entries(byCustomer)) {
      const hasPriority = crows.some(r => ['Accepted','In Progress'].includes(r.status || ''));
      if (hasPriority) { winningGroup = crows; break; }
    }
    if (!winningGroup) winningGroup = Object.values(byCustomer)[0];

    // Sum hours and merge pmcGroup across the winning group's rows
    let sumHours = 0;
    const mergedPmc = {};
    for (const r of winningGroup) {
      const h = Number(r.hours) || 0;
      sumHours += h;
      const cf = r.customFields || {};
      const pmg = cf.pmcGroup;
      if (pmg && typeof pmg === 'object') {
        for (const [cat, hrs] of Object.entries(pmg)) {
          mergedPmc[cat] = (mergedPmc[cat] || 0) + Number(hrs);
        }
      }
      console.log(`  [${r.status}] ${r.customer} | hours=${h} | src=${cf.pmcMappingSource || 'none'}`);
    }

    const pmcSum = Object.values(mergedPmc).reduce((s, h) => s + h, 0);
    console.log(`  → sumHours=${Math.round(sumHours)}, pmcSum=${Math.round(pmcSum)}`);
    if (Math.abs(pmcSum - sumHours) > 1) {
      console.log(`  *** MISMATCH: pmcSum differs from sumHours by ${Math.round(pmcSum - sumHours)}`);
    }
    totalAcceptedAfterDedup += sumHours;
  }

  console.log(`\n=== Total Accepted hours after regen dedup logic: ${Math.round(totalAcceptedAfterDedup)} ===`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
