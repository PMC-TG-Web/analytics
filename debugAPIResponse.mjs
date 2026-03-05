import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Simulate what the API returns
  const schedules = await prisma.schedule.findMany({
    where: {
      projectName: { contains: 'Giant' }
    },
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectName: true,
      projectNumber: true,
      status: true,
      totalHours: true,
      allocationsList: {
        select: {
          period: true,
          hours: true,
          percent: true,
        },
        orderBy: { period: 'asc' },
      },
    },
  });

  // Transform like the API does
  const apiData = schedules.map((s) => {
    const { allocationsList, ...rest } = s;
    return {
      ...rest,
      allocations: allocationsList.map((alloc) => ({
        month: alloc.period,
        percent: alloc.percent || 0,
        hours: alloc.hours,
      })),
    };
  });

  console.log('API Response (raw):');
  console.log(JSON.stringify(apiData, null, 2));
  
  // Now check what the frontend converts this to
  console.log('\n\nFrontend conversion:');
  const frontendSchedules = apiData.map((s) => {
    let allocations = {};
    if (s.allocations) {
      if (Array.isArray(s.allocations)) {
        // Array format: convert to object using PERCENT not HOURS!
        allocations = s.allocations.reduce((acc, alloc) => {
          acc[alloc.month] = alloc.percent;  // <-- Using percent
          return acc;
        }, {});
      } else {
        allocations = s.allocations;
      }
    }
    
    return {
      jobKey: s.jobKey,
      customer: s.customer,
      projectName: s.projectName,
      status: s.status || 'Unknown',
      totalHours: s.totalHours,
      allocations,
    };
  });
  
  console.log(JSON.stringify(frontendSchedules, null, 2));
  
  // Check what percentage values would produce 12,223 hours in January
  console.log('\n\nReverse engineering the bug:');
  console.log('If Giant #6582 shows 12,223 hours in January...');
  const buggyPercent = (12223 / 3756) * 100;
  console.log(`That would require an allocation of ${buggyPercent.toFixed(1)}% (which is ${buggyPercent.toFixed(1) / 25} times the actual 25%)`);
  
  // Check if all allocations are being summed instead of using single month
  const totalPercent = frontendSchedules[0].allocations ? Object.values(frontendSchedules[0].allocations).reduce((sum, p) => sum + p, 0) : 0;
  console.log(`\nTotal percent across ALL months: ${totalPercent}%`);
  console.log(`3756 * (${totalPercent}/100) = ${(3756 * totalPercent / 100).toFixed(2)}`);
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
