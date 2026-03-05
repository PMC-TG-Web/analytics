import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const jobsToCheck = [
    { customer: 'Heck Construction', name: 'Gish Furniture Sitework' },
    { customer: 'Hoover Building Specialists, Inc.', name: 'Kemper Equipment' },
    { customer: 'Hoover Building Specialists, Inc.', name: 'Sauders Feedmill' }
  ];
  
  for (const job of jobsToCheck) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${job.customer} - ${job.name}`);
    console.log('='.repeat(70));
    
    // Find all Project records matching this job
    const projects = await prisma.project.findMany({
      where: {
        customer: job.customer,
        projectName: { contains: job.name }
      },
      select: {
        id: true,
        customer: true,
        projectNumber: true,
        projectName: true,
        hours: true,
        status: true,
      }
    });
    
    console.log(`\nFound ${projects.length} Project record(s):\n`);
    
    let totalHours = 0;
    projects.forEach((p, idx) => {
      const jobKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
      console.log(`[${idx + 1}] ${jobKey}`);
      console.log(`    ID: ${p.id}`);
      console.log(`    Hours: ${p.hours}`);
      console.log(`    Status: ${p.status}`);
      totalHours += p.hours || 0;
    });
    
    console.log(`\n  Total hours from all records: ${totalHours}`);
    
    // Check ProjectScopes
    const scopes = await prisma.projectScope.findMany({
      where: {
        jobKey: { contains: job.name }
      },
      select: {
        id: true,
        jobKey: true,
        title: true,
        hours: true,
        startDate: true,
        endDate: true,
      }
    });
    
    console.log(`\n  ProjectScope records: ${scopes.length}`);
    if (scopes.length > 0) {
      let scopeTotal = 0;
      scopes.forEach(s => {
        scopeTotal += s.hours || 0;
      });
      console.log(`  Total scope hours: ${scopeTotal}`);
      console.log(`  Multiplier: ${(scopeTotal / (projects[0]?.hours || 1)).toFixed(2)}x`);
    }
  }
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
