/**
 * checkAccepted.cjs - Show all Accepted projects with their hours and pmcGroup sources
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    where: { status: 'Accepted' },
    select: { projectName: true, customer: true, hours: true, customFields: true },
    orderBy: { projectName: 'asc' },
  });

  console.log(`Total Accepted rows in DB: ${projects.length}`);
  let totalHrs = 0;
  let pmcTotal = 0;

  for (const p of projects) {
    const cf = p.customFields || {};
    const pmg = cf.pmcGroup;
    const pmcSource = cf.pmcMappingSource || 'none';
    const hrs = Number(p.hours) || 0;
    totalHrs += hrs;

    let pmcSum = 0;
    if (pmg && typeof pmg === 'object') {
      pmcSum = Object.values(pmg).reduce((s, h) => s + Number(h), 0);
      pmcTotal += pmcSum;
    }

    console.log(`  ${p.projectName} | ${p.customer} | hours=${hrs} | pmcSum=${Math.round(pmcSum)} | source=${pmcSource}`);
    if (pmg && typeof pmg === 'object') {
      for (const [k, v] of Object.entries(pmg)) {
        console.log(`    ${k}: ${v}`);
      }
    }
  }

  console.log(`\nTotal raw hours field: ${Math.round(totalHrs)}`);
  console.log(`Total pmcGroup sum:    ${Math.round(pmcTotal)}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
