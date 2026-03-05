import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Check if there are MULTIPLE ScheduleAllocation records for the same Schedule+Period
  const duplicateAllocations = await prisma.$queryRaw`
    SELECT 
      sa."scheduleId",
      sa.period,
      COUNT(*) as count,
      SUM(sa.hours) as "totalHours"
    FROM "ScheduleAllocation" sa
    GROUP BY sa."scheduleId", sa.period
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `;
  
  console.log('Duplicate allocations per Schedule+Period:\n');
  if (duplicateAllocations.length === 0) {
    console.log('  None found - database constraint is working correctly');
  } else {
    console.log(`  Found ${duplicateAllocations.length} violations:\n`);
    duplicateAllocations.forEach(row => {
      console.log(`  Schedule ${row.scheduleId}, Period ${row.period}:`);
      console.log(`    ${row.count} duplicate allocation records`);
      console.log(`    Total hours: ${row.totalHours}`);
      console.log('');
    });
  }
  
  // Also check if there might be a broader issue - maybe allocations were imported wrong
  // Let's check specifically for Giant #6582
  const giantAllocations = await prisma.scheduleAllocation.findMany({
    where: {
      schedule: {
        projectName: { contains: 'Giant #6582' }
      }
    },
    select: {
      id: true,
      period: true,
      hours: true,
      percent: true,
      schedule: {
        select: {
          jobKey: true,
          totalHours: true
        }
      }
    },
    orderBy: { period: 'asc' }
  });
  
  console.log('Giant #6582 allocations from database:\n');
  giantAllocations.forEach(alloc => {
    console.log(`  ${alloc.period}: ${alloc.hours}h (${alloc.percent}%)`);
    const calculated = (alloc.schedule.totalHours || 0) * (alloc.percent || 0) / 100;
    console.log(`    Should be: 3756 * ${alloc.percent}% = ${calculated}h`);
    if (Math.abs(alloc.hours - calculated) > 0.01) {
      console.log(`    ⚠️ MISMATCH!`);
    }
  });
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
