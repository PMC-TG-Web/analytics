import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const allocations2026 = await prisma.scheduleAllocation.findMany({
    where: {
      period: { startsWith: '2026' }
    },
    select: {
      period: true,
      percent: true,
    }
  });
  
  const byPercent = {};
  allocations2026.forEach(a => {
    const key = a.percent === null ? 'NULL' : (a.percent === 0 ? 'ZERO' : `${a.percent}%`);
    byPercent[key] = (byPercent[key] || 0) + 1;
  });
  
  console.log('2026 Allocations by Percent Value:');
  Object.entries(byPercent).sort().forEach(([key, count]) => {
    console.log(`  ${key}: ${count}`);
  });
  
  // Count usable allocations
  const usable = allocations2026.filter(a => a.percent !== null && a.percent > 0);
  console.log(`\nUsable allocations (percent !== null AND > 0): ${usable.length}`);
  
  // Show distribution
  const byMonth = {};
  usable.forEach(a => {
    const month = a.period.split('-')[1];
    byMonth[month] = (byMonth[month] || 0) + 1;
  });
  
  console.log(`\nUsable allocations by month:`);
  Object.keys(byMonth).sort().forEach(month => {
    console.log(`  2026-${month}: ${byMonth[month]}`);
  });
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
