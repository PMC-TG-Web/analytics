import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get all qualifying projects
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
  
  // Build project map
  const projectMap = new Map();
  projects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    projectMap.set(key, Number(p.sales || 0));
  });
  
  // Get all schedules with 2026 allocations and valid percentages
  const schedules = await prisma.schedule.findMany({
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      allocationsList: {
        select: {
          period: true,
          percent: true,
        },
        where: {
          period: { startsWith: '2026' },
          percent: { not: null }
        }
      }
    },
    where: {
      allocationsList: {
        some: {
          period: { startsWith: '2026' },
          percent: { not: null }
        }
      }
    }
  });
  
  const scheduledSalesByMonth = {};
  let totalScheduledSales = 0;
  
  schedules.forEach(schedule => {
    const key = `${schedule.customer || ''}~${schedule.projectNumber || ''}~${schedule.projectName || ''}`;
    const projectSales = projectMap.get(key);
    
    if (projectSales && projectSales > 0) {
      schedule.allocationsList.forEach(alloc => {
        const monthKey = alloc.period;
        const percent = Number(alloc.percent || 0);
        
        if (!isNaN(percent) && percent > 0) {
          const monthlySales = projectSales * (percent / 100);
          scheduledSalesByMonth[monthKey] = (scheduledSalesByMonth[monthKey] || 0) + monthlySales;
          totalScheduledSales += monthlySales;
        }
      });
    }
  });
  
  console.log('=== 2026 Scheduled Sales Calculation ===\n');
  console.log(`Qualifying projects: ${projects.length}`);
  console.log(`Schedules with allocations: ${schedules.length}`);
  console.log(`\nScheduled Sales by Month:`);
  
  const months = Object.keys(scheduledSalesByMonth).sort();
  const monthTotals = {};
  
  months.forEach(month => {
    const sales = scheduledSalesByMonth[month];
    const [year, m] = month.split('-');
    if (!monthTotals[year]) monthTotals[year] = {};
    monthTotals[year][Number(m)] = sales;
    
    console.log(`  ${month}: $${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  });
  
  console.log(`\nTotal 2026 Scheduled Sales: $${totalScheduledSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  
  // Show by year
  console.log('\n=== Breakdown by Year ===');
  Object.entries(monthTotals).forEach(([year, months]) => {
    const yearTotal = Object.values(months).reduce((sum, val) => sum + val, 0);
    console.log(`${year}: $${yearTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    Object.entries(months).forEach(([month, sales]) => {
      console.log(`  Month ${month}: $${Number(sales).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    });
  });
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
