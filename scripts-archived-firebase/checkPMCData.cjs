/**
 * checkPMCData.cjs
 * Inspect pmcGroup/pmcBreakdown data for Bid Submitted projects
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Get a sample of Bid Submitted projects
  const projects = await prisma.project.findMany({
    where: { status: 'Bid Submitted' },
    select: { id: true, projectName: true, customer: true, hours: true, customFields: true },
    take: 20,
  });

  console.log(`\nFound ${projects.length} Bid Submitted projects (sample)\n`);

  let withPMCGroup = 0;
  let pmcGroupIsObject = 0;
  let pmcGroupIsString = 0;
  let pmcGroupNull = 0;

  for (const p of projects) {
    const cf = p.customFields || {};
    const pmcGroup = cf.pmcGroup;
    
    if (pmcGroup === null || pmcGroup === undefined) {
      pmcGroupNull++;
      console.log(`  [NULL] ${p.projectName} (${p.customer}) - hours: ${p.hours}`);
    } else if (typeof pmcGroup === 'object') {
      pmcGroupIsObject++;
      withPMCGroup++;
      const keys = Object.keys(pmcGroup);
      console.log(`  [OBJ] ${p.projectName} (${p.customer}) - keys: ${keys.join(', ')}`);
    } else if (typeof pmcGroup === 'string') {
      pmcGroupIsString++;
      withPMCGroup++;
      console.log(`  [STR] ${p.projectName} (${p.customer}) - value: "${pmcGroup}"`);
    } else {
      console.log(`  [???] ${p.projectName} (${p.customer}) - typeof: ${typeof pmcGroup}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  pmcGroup is object: ${pmcGroupIsObject}`);
  console.log(`  pmcGroup is string: ${pmcGroupIsString}`);
  console.log(`  pmcGroup is null:   ${pmcGroupNull}`);
  
  // Count totals across ALL Bid Submitted
  const allBidSubmitted = await prisma.project.findMany({
    where: { status: 'Bid Submitted' },
    select: { customFields: true, hours: true },
  });
  
  let totalObjPMC = 0, totalStrPMC = 0, totalNullPMC = 0;
  let hoursWithObjPMC = 0, hoursWithStrPMC = 0, hoursWithNullPMC = 0;
  
  for (const p of allBidSubmitted) {
    const cf = p.customFields || {};
    const pmg = cf.pmcGroup;
    const hrs = Number(p.hours) || 0;
    if (pmg === null || pmg === undefined) {
      totalNullPMC++;
      hoursWithNullPMC += hrs;
    } else if (typeof pmg === 'object') {
      totalObjPMC++;
      hoursWithObjPMC += hrs;
    } else if (typeof pmg === 'string') {
      totalStrPMC++;
      hoursWithStrPMC += hrs;
    }
  }
  
  console.log(`\n--- ALL Bid Submitted (${allBidSubmitted.length} total) ---`);
  console.log(`  Object pmcGroup: ${totalObjPMC} projects, ${hoursWithObjPMC.toFixed(0)} hours`);
  console.log(`  String pmcGroup: ${totalStrPMC} projects, ${hoursWithStrPMC.toFixed(0)} hours`);
  console.log(`  Null  pmcGroup:  ${totalNullPMC} projects, ${hoursWithNullPMC.toFixed(0)} hours`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
