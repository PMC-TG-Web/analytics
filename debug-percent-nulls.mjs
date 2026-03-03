import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 2026 ScheduleAllocation Percent Analysis ===\n');
  
  // Get all 2026 allocations
  const all2026 = await prisma.scheduleAllocation.findMany({
    where: {
      period: {
        startsWith: '2026'
      }
    },
    select: {
      period: true,
      percent: true,
      hours: true,
      scheduleId: true,
    }
  });
  
  console.log(`Total 2026 allocations: ${all2026.length}`);
  
  const withPercent = all2026.filter(a => a.percent !== null && a.percent !== 0);
  const nullPercent = all2026.filter(a => a.percent === null);
  const zeroPercent = all2026.filter(a => a.percent === 0);
  
  console.log(`  With valid percent: ${withPercent.length}`);
  console.log(`  With NULL percent: ${nullPercent.length}`);
  console.log(`  With ZERO percent: ${zeroPercent.length}`);
  
  // Calculate what would be scheduled if we only use valid percentages
  const schedulesWithValidPercent = new Set(withPercent.map(a => a.scheduleId));
  console.log(`\nSchedules with at least one valid allocation: ${schedulesWithValidPercent.size}`);
  
  // Get projects and match
  const relevantAllocations = await prisma.scheduleAllocation.findMany({
    where: {
      period: {
        startsWith: '2026'
      },
      percent: {
        not: null
      }
    },
    select: {
      period: true,
      percent: true,
      schedule: {
        select: {
          customer: true,
          projectNumber: true,
          projectName: true,
        }
      }
    }
  });
  
  // Get matching projects  
  const projectMap = new Map();
  const projects = await prisma.project.findMany({
    where: {
      status: {
        in: ['In Progress', 'Accepted', 'Complete']
      }
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      sales: true,
    }
  });
  
  projects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    projectMap.set(key, Number(p.sales || 0));
  });
  
  // Calculate scheduled sales from valid allocations only
  let totalScheduledSales = 0;
  const scheduleDetails = new Map();
  
  relevantAllocations.forEach(alloc => {
    const key = `${alloc.schedule.customer || ''}~${alloc.schedule.projectNumber || ''}~${alloc.schedule.projectName || ''}`;
    const projectSales = projectMap.get(key);
    
    if (projectSales) {
      const monthlySales = projectSales * (alloc.percent / 100);
      totalScheduledSales += monthlySales;
      
      const schedKey = `${alloc.schedule.customer}`;
      if (!scheduleDetails.has(schedKey)) {
        scheduleDetails.set(schedKey, 0);
      }
      scheduleDetails.set(schedKey, scheduleDetails.get(schedKey) + monthlySales);
    }
  });
  
  console.log(`\nCalculated 2026 Scheduled Sales (with valid allocations):  $${totalScheduledSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  
  // Show breakdown by customer
  console.log('\n=== Top Customers by Scheduled Sales ===');
  const sortedCustomers = Array.from(scheduleDetails.entries()).sort((a, b) => b[1] - a[1]);
  sortedCustomers.slice(0, 10).forEach(([customer, sales]) => {
    console.log(`  ${customer}: $${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  });
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
