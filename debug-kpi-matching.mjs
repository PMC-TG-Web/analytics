import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Detailed 2026 Schedule-to-Project Matching ===\n');
  
  // Get all schedules with 2026 allocations
  const schedulesWithAllocations = await prisma.schedule.findMany({
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      allocationsList: {
        select: {
          period: true,
          percent: true,
        },
        where: {
          period: {
            startsWith: '2026',
          }
        }
      }
    },
  });
  
  const schedulesWithMatch = schedulesWithAllocations.filter(s => s.allocationsList.length > 0);
  console.log(`Total schedules with 2026 allocations: ${schedulesWithMatch.length}\n`);
  
  // For each schedule, try to find matching project
  for (const sched of schedulesWithMatch) {
    console.log(`Schedule: ${sched.customer}~${sched.projectNumber}~${sched.projectName}`);
    console.log(`  JobKey: ${sched.jobKey}`);
    console.log(`  2026 Allocations: ${sched.allocationsList.map(a => `${a.period}:${a.percent}%`).join(', ')}`);
    
    // Try to match by customer~projectNumber~projectName
    let matchedProject = null;
    
    // If not matched by jobKey, try by customer~projectNumber~projectName
    if (!matchedProject) {
      matchedProject = await prisma.project.findFirst({
        where: {
          AND: [
            { customer: sched.customer },
            { projectNumber: sched.projectNumber },
            { projectName: sched.projectName },
          ]
        },
        select: {
          customer: true,
          projectNumber: true,
          projectName: true,
          status: true,
          sales: true,
        }
      });
      
      if (matchedProject) {
        console.log(`  ✓ Matched by customer~number~name: ${matchedProject.status}, sales: $${Number(matchedProject.sales || 0).toLocaleString()}`);
      }
    }
    
    // Try to find ANY project with this customer
    if (!matchedProject) {
      const projectsByCustomer = await prisma.project.findMany({
        where: {
          customer: sched.customer,
        },
        select: {
          customer: true,
          projectNumber: true,
          projectName: true,
          status: true,
          sales: true,
        },
        take: 3,
      });
      
      if (projectsByCustomer.length > 0) {
        console.log(`  ✗ No direct match, but found ${projectsByCustomer.length} projects for this customer:`);
        projectsByCustomer.forEach(p => {
          console.log(`    - ${p.projectName} (status: ${p.status}, sales: $${Number(p.sales || 0).toLocaleString()})`);
        });
      } else {
        console.log(`  ✗ No project found for this customer`);
      }
    }
    
    console.log();
  }
  
  // Now check if there are ANY projects in qualifying status that DON'T have schedules
  console.log('\n=== Projects with Qualifying Status But NO 2026 Schedules ===');
  const qualifyingProjects = await prisma.project.findMany({
    where: {
      status: {
        in: ['In Progress', 'Accepted', 'Complete']
      },
      AND: [
        { sales: { not: null } },
        { sales: { gt: 0 } }
      ]
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      sales: true,
    },
    take: 10,
  });
  
  console.log(`Found ${qualifyingProjects.length} qualifying projects with sales > 0:`);
  
  for (const proj of qualifyingProjects) {
    // Check if this project has any schedule
    const hasSchedule = await prisma.schedule.findFirst({
      where: {
        AND: [
          { customer: proj.customer },
          { projectNumber: proj.projectNumber },
          { projectName: proj.projectName },
        ]
      }
    });
    
    const scheduleStatus = hasSchedule ? '✓ Has schedule' : '✗ NO schedule';
    console.log(`  ${proj.customer}~${proj.projectNumber}~${proj.projectName}: ${proj.status}, $${Number(proj.sales).toLocaleString()} - ${scheduleStatus}`);
  }
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
