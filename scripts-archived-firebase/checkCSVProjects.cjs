/**
 * checkCSVProjects.cjs - Check what CSV-imported null-pmcGroup projects look like
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find a null-pmcGroup Bid Submitted project
  const nullProjects = await prisma.project.findMany({
    where: { status: 'Bid Submitted' },
    select: { projectName: true, hours: true, customFields: true },
    take: 40,
  });

  // Find one with no pmcGroup but with non-empty customFields
  const sample = nullProjects.find(p => {
    const cf = p.customFields || {};
    return !cf.pmcGroup && Object.keys(cf).length > 0;
  });

  if (sample) {
    const cf = sample.customFields || {};
    console.log('Sample CSV project:', sample.projectName, '| hours:', sample.hours);
    console.log('customFields keys:', Object.keys(cf).join(', '));
    console.log('customFields:', JSON.stringify(cf, null, 2).substring(0, 800));
  } else {
    console.log('No null-pmcGroup projects found in first 40');
  }

  // Count projects with lineItems vs without
  const all = await prisma.project.findMany({
    select: { status: true, customFields: true, hours: true }
  });
  
  let withLineItems = 0, withoutLineItems = 0;
  let withSource = 0;
  const sourceCounts = {};
  
  for (const p of all) {
    const cf = p.customFields || {};
    if (Array.isArray(cf.lineItems) && cf.lineItems.length > 0) {
      withLineItems++;
    } else {
      withoutLineItems++;
      if (cf.source) {
        sourceCounts[cf.source] = (sourceCounts[cf.source] || 0) + 1;
        withSource++;
      }
    }
  }
  
  console.log(`\n--- All ${all.length} projects ---`);
  console.log(`With lineItems:    ${withLineItems}`);
  console.log(`Without lineItems: ${withoutLineItems} (${withSource} with source field)`);
  console.log('Source breakdown:', JSON.stringify(sourceCounts, null, 2));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
