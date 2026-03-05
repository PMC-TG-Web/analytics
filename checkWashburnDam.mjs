import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Find Washburn Dam schedule
  const schedules = await prisma.schedule.findMany({
    where: {
      OR: [
        { customer: { contains: 'Berg' } },
        { projectName: { contains: 'Washburn' } }
      ]
    },
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      totalHours: true,
      allocationsList: {
        select: {
          period: true,
          hours: true,
          percent: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { period: 'asc' }
      }
    }
  });
  
  console.log(`Found ${schedules.length} schedules matching Berg/Washburn\n`);
  
  schedules.forEach(s => {
    console.log(`${s.customer} - ${s.projectName}`);
    console.log(`  Job Key: ${s.jobKey}`);
    console.log(`  Project #: ${s.projectNumber}`);
    console.log(`  Total Hours: ${s.totalHours}`);
    console.log(`  Status: ${s.status}`);
    console.log(`\n  Allocations:`);
    
    if (s.allocationsList.length === 0) {
      console.log(`    None found`);
    } else {
      s.allocationsList.forEach(alloc => {
        console.log(`    ${alloc.period}: ${alloc.percent}% (${alloc.hours}h)`);
        console.log(`      Created: ${alloc.createdAt}`);
        console.log(`      Updated: ${alloc.updatedAt}`);
      });
      
      const totalPercent = s.allocationsList.reduce((sum, a) => sum + (a.percent || 0), 0);
      console.log(`\n  Total allocation: ${totalPercent}%`);
    }
    console.log('\n');
  });
  
  // Check if this project exists in WIP3.csv source data
  console.log('\n=== Checking if "Washburn Dam" exists in any Project records ===\n');
  
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { customer: { contains: 'Berg' } },
        { projectName: { contains: 'Washburn' } }
      ]
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      hours: true,
      status: true,
    }
  });
  
  console.log(`Found ${projects.length} projects:\n`);
  projects.forEach(p => {
    console.log(`  ${p.customer} - ${p.projectNumber}: ${p.projectName}`);
    console.log(`    Hours: ${p.hours}, Status: ${p.status}`);
  });
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
