import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Get API response (simulate)
  const schedulesFromDB = await prisma.schedule.findMany({
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
  
  // Count 2026 allocations
  let count2026 = 0;
  let countNull = 0;
  const schedulesWith2026 = [];
  
  schedulesFromDB.forEach(s => {
    const alloc2026 = s.allocationsList.filter(a => a.period.startsWith('2026'));
    if (alloc2026.length > 0) {
      schedulesWith2026.push({
        ...s,
        allocations2026: alloc2026
      });
      count2026 += alloc2026.length;
      alloc2026.forEach(a => {
        if (a.percent === null) countNull++;
      });
    }
  });
  
  console.log(`Schedules with 2026 allocations: ${schedulesWith2026.length}`);
  console.log(`Total 2026 allocations: ${count2026}`);
  console.log(`2026 allocations with NULL percent: ${countNull}`);
  console.log(`2026 allocations with valid percent: ${count2026 - countNull}`);
  
  // Show months covered
  const monthSet = new Set();
  schedulesWith2026.forEach(s => {
    s.allocations2026.forEach(a => {
      if (a.percent !== null && a.percent > 0) {
        const month = a.period.split('-')[1];
        monthSet.add(Number(month));
      }
    });
  });
  
  console.log(`\nMonths with valid percent > 0:`, Array.from(monthSet).sort((a, b) => a - b).join(', '));
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
