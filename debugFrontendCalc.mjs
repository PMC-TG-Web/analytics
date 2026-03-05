import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get the schedule and ALL its allocations including missing months
  const schedule = await prisma.schedule.findUnique({
    where: {
      jobKey: 'Ames Construction, Inc.~2508 - GI~Giant #6582'
    },
    select: {
      jobKey: true,
      projectName: true,
      totalHours: true,
      allocationsList: {
        select: {
          id: true,
          period: true,
          hours: true,
          percent: true,
        },
        orderBy: { period: 'asc' }
      }
    }
  });
  
  console.log('Schedule allocationsList from DB:');
  console.log(JSON.stringify(schedule?.allocationsList, null, 2));
  
  // Now simulate the API transformation
  if (schedule) {
    const allocationsArray = schedule.allocationsList.map(alloc => ({
      month: alloc.period,
      percent: alloc.percent || 0,
      hours: alloc.hours,
    }));
    
    // Transform to object for frontend
    const allocationsObject = allocationsArray.reduce((acc, alloc) => {
      acc[alloc.month] = alloc.percent;
      return acc;
    }, {});
    
    console.log('\nTransformed to frontend format:');
    console.log(JSON.stringify(allocationsObject, null, 2));
    
    // Simulate frontend calculation
    console.log('\nSimulating frontend calculation for each month:');
    Object.entries(allocationsObject).forEach(([month, percent]) => {
      const calc = (3756 * (percent / 100));
      console.log(`  ${month}: 3756 * (${percent}/100) = ${calc.toFixed(2)}h`);
    });
  }
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
