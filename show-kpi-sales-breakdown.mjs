import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const qualifyingStatuses = ['In Progress', 'Accepted', 'Complete'];

async function main() {
  console.log('=== Sales Dollars Used in KPI Calculation ===\n');
  
  // Get all qualifying projects (matching what KPI page does)
  const projects = await prisma.project.findMany({
    where: {
      status: {
        in: qualifyingStatuses
      }
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      sales: true,
    },
    orderBy: { sales: 'desc' }
  });
  
  console.log(`Total projects with qualifying status: ${projects.length}\n`);
  
  // Show distribution
  let totalSales = 0;
  let salesCount = 0;
  let nullCount = 0;
  let zeroCount = 0;
  
  projects.forEach(p => {
    const sales = Number(p.sales ?? 0);
    totalSales += sales;
    if (p.sales === null) nullCount++;
    else if (sales === 0) zeroCount++;
    else salesCount++;
  });
  
  console.log(`Projects by sales value:`);
  console.log(`  With sales > 0: ${salesCount}`);
  console.log(`  With sales = 0: ${zeroCount}`);
  console.log(`  With NULL sales: ${nullCount}`);
  console.log(`\nTotal Sales (all qualifying projects): $${totalSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  
  // Show top projects being used for 2026 calculations
  console.log(`\n=== Top 15 Projects Contributing to 2026 Scheduled Sales ===\n`);
  
  // Get schedules with 2026 allocations
  const schedules2026 = await prisma.schedule.findMany({
    where: {
      allocationsList: {
        some: {
          period: { startsWith: '2026' }
        }
      }
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      allocationsList: {
        where: {
          period: { startsWith: '2026' }
        }
      }
    }
  });
  
  // Match to projects and sum allocations
  const scheduleToSales = {};
  
  for (const sched of schedules2026) {
    const matchingProject = projects.find(p => 
      p.customer === sched.customer &&
      p.projectNumber === sched.projectNumber &&
      p.projectName === sched.projectName
    );
    
    if (matchingProject) {
      const sales = Number(matchingProject.sales ?? 0);
      const totalPercent = sched.allocationsList.reduce((sum, a) => sum + (a.percent || 0), 0);
      const scheduledDollars = sales * (totalPercent / 100);
      
      scheduleToSales[`${sched.customer}~${sched.projectNumber}~${sched.projectName}`] = {
        sales,
        percent: totalPercent,
        scheduled: scheduledDollars
      };
    }
  }
  
  // Sort by scheduled dollars
  const sorted = Object.entries(scheduleToSales)
    .sort((a, b) => b[1].scheduled - a[1].scheduled)
    .slice(0, 15);
  
  let runningTotal = 0;
  sorted.forEach(([key, data], idx) => {
    runningTotal += data.scheduled;
    const name = key.split('~')[1] + '~' + key.split('~')[2];
    console.log(`${idx + 1}. ${name}`);
    console.log(`   Sales: $${data.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`   Allocation: ${data.percent}%`);
    console.log(`   Contributing: $${data.scheduled.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  });
  
  console.log(`\nTotal from top 15: $${runningTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
