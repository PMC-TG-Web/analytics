import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const qualifyingStatuses = ['In Progress', 'Accepted', 'Complete'];

function getProjectKey(customer, projectNumber, projectName) {
  return `${customer ?? ''}~${projectNumber ?? ''}~${projectName ?? ''}`;
}

function normalizeAllocations(allocations) {
  if (!allocations) return [];
  if (Array.isArray(allocations)) return allocations;
  return Object.entries(allocations).map(([month, percent]) => ({
    month,
    percent: Number(percent) || 0,
  }));
}

function isValidMonthKey(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

async function main() {
  console.log('=== KPI Page Calculation Mimic ===\n');
  
  // 1. Get projects
  const projects = await prisma.project.findMany({
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      sales: true,
    }
  });
  console.log(`Total projects: ${projects.length}`);
  
  // 2. Get schedules with allocations (as the API returns them)
  const schedules = await prisma.schedule.findMany({
    select: {
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      allocationsList: {
        select: {
          period: true,
          percent: true,
        },
        orderBy: { period: 'asc' }
      }
    }
  });
  
  console.log(`Total schedules from DB: ${schedules.length}`);
  
  // Transform to match API response format
  const schedulesData = schedules.map(s => ({
    ...s,
    allocations: s.allocationsList.map(alloc => ({
      month: alloc.period,
      percent: alloc.percent || 0,
    }))
  }));
  
  // 3. Build scheduleSalesMap - matching what the KPI page does
  const scheduleSalesMap = new Map();
  projects.forEach(project => {
    if (!qualifyingStatuses.includes(project.status || '')) return;
    
    const key = getProjectKey(project.customer, project.projectNumber, project.projectName);
    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales)) return;
    
    const currentTotal = scheduleSalesMap.get(key) || 0;
    scheduleSalesMap.set(key, currentTotal + sales);
  });
  
  console.log(`Projects with qualifying status: ${scheduleSalesMap.size}`);
  console.log(`Sample: `);
  Array.from(scheduleSalesMap.entries()).slice(0, 3).forEach(([key, sales]) => {
    console.log(`  ${key}: $${Number(sales).toLocaleString()}`);
  });
  
  // 4. Calculate scheduledSalesByMonth
  const scheduledSalesByMonth = {};
  
  schedulesData.forEach(schedule => {
    const key = schedule.jobKey || getProjectKey(schedule.customer, schedule.projectNumber, schedule.projectName);
    const projectSales = scheduleSalesMap.get(key);
    
    if (!projectSales) return;
    
    normalizeAllocations(schedule.allocations).forEach(alloc => {
      const percent = Number(alloc.percent ?? 0);
      if (!Number.isFinite(percent) || percent <= 0) return;
      const monthKey = alloc.month;
      if (!isValidMonthKey(monthKey)) return;
      const monthlySales = projectSales * (percent / 100);
      scheduledSalesByMonth[monthKey] = (scheduledSalesByMonth[monthKey] || 0) + monthlySales;
    });
  });
  
  const scheduledTotal = Object.values(scheduledSalesByMonth).reduce((sum, val) => sum + val, 0);
  
  console.log(`\nSchedules used for allocation: ${schedulesData.length}`);
  console.log(`Total Scheduled sales: $${scheduledTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`\nScheduled sales by month:`);
  Object.keys(scheduledSalesByMonth).sort().forEach(month => {
    const sales = scheduledSalesByMonth[month];
    console.log(`  ${month}: $${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  });
  
  // 5. Filter for 2026
  const filtered2026 = Object.entries(scheduledSalesByMonth)
    .filter(([month]) => month.startsWith('2026'))
    .reduce((map, [month, sales]) => {
      map[month] = sales;
      return map;
    }, {});
  
  const total2026 = Object.values(filtered2026).reduce((sum, val) => sum + val, 0);
  console.log(`\n2026 Scheduled Sales Total: $${total2026.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  
  // Count 2026 months
  const count2026 =  Object.keys(filtered2026).length;
  console.log(`2026 months with allocations: ${count2026}`);
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
