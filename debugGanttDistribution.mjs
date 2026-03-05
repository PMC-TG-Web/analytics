import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get Giant #6582 scopes with dates and those without
  const scopesWithDates = await prisma.projectScope.findMany({
    where: {
      jobKey: 'Ames Construction, Inc.~2508 - GI~Giant #6582',
      startDate: { not: null },
      endDate: { not: null }
    },
    select: {
      title: true,
      hours: true,
      startDate: true,
      endDate: true,
    }
  });
  
  const scopesWithoutDates = await prisma.projectScope.findMany({
    where: {
      jobKey: 'Ames Construction, Inc.~2508 - GI~Giant #6582',
      OR: [
        { startDate: null },
        { endDate: null }
      ]
    },
    select: {
      title: true,
      hours: true,
    }
  });
  
  console.log(`Giant #6582 ProjectScopes:\n`);
  console.log(`Scopes WITH valid dates: ${scopesWithDates.length}`);
  const totalWithDates = scopesWithDates.reduce((sum, s) => sum + (s.hours || 0), 0);
  console.log(`  Total hours: ${totalWithDates}\n`);
  
  console.log(`Scopes WITHOUT valid dates: ${scopesWithoutDates.length}`);
  const totalWithoutDates = scopesWithoutDates.reduce((sum, s) => sum + (s.hours || 0), 0);
  console.log(`  Total hours: ${totalWithoutDates}\n`);
  
  // Now simulate the distribution
  console.log(`\n=== DISTRIBUTION CALCULATION ===`);
  console.log(`When the frontend processes the 19 valid scopes...`);
  console.log(`Start date: 2026-01-01, End date: 2026-06-30`);
  
  const startStr = '2026-01-01';
  const endStr = '2026-06-30';
  const start = new Date(startStr);
  const end = new Date(endStr);
  
  const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1);
  console.log(`Total days: ${totalDays}`);
  
  const dailyRate = totalWithDates / totalDays;
  console.log(`Daily rate: ${totalWithDates} / ${totalDays} = ${dailyRate.toFixed(2)}`);
  
  // Calculate January distribution (31 days, but maybe not all if it starts later)
  const janStart = new Date(2026, 0, 1);  // Jan 1
  const janEnd = new Date(2026, 0, 31);   // Jan 31
  
  const overlapStart = start.getTime() > janStart.getTime() ? start : janStart;
  const overlapEnd = end.getTime() <janEnd.getTime() ? end : janEnd;
  const janDays = Math.max(0, (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24) + 1);
  const janHours = dailyRate * janDays;
  
  console.log(`\nJanuary calculation:`);
  console.log(`  Overlap days: ${janDays}`);
  console.log(`  Hours: ${dailyRate.toFixed(2)} * ${janDays} = ${janHours.toFixed(0)}`);
  
  // But wait - what if EACH scope is being processed separately?
  console.log(`\n\n=== ALTERNATIVE: EACH SCOPE DISTRIBUTED SEPARATELY ===`);
  console.log(`If each of the 19 scopes is distributed across all 6 months...`);
  
  let totalJanHoursAlt = 0;
  scopesWithDates.forEach(scope => {
    if (!scope.hours) return;
    const dailyRate = scope.hours / totalDays;
    const janHours = dailyRate * janDays;
    totalJanHoursAlt += janHours;
  });
  
  console.log(`Sum of January hours from individual scopes: ${totalJanHoursAlt.toFixed(0)}`);
  
  // Check multiplier
  console.log(`\n\n=== VERIFICATION ===`);
  const projectHours = 3756;
  console.log(`Project total hours: ${projectHours}`);
  console.log(`Total scope hours: ${totalWithDates}`);
  console.log(`Multiplier: ${totalWithDates} / ${projectHours} = ${(totalWithDates / projectHours).toFixed(2)}x`);
  
  console.log(`\nJanuary from scopes: ${janHours.toFixed(0)}`);
  console.log(`If this is multiplied by 100% allocation: ${janHours.toFixed(0)} hours`);
  console.log(`BUT allocation should be 25%, so: 3756 * 0.25 = 939 hours`);
  
  // OH WAIT - what if the Gantt hours are being ADDED to allocation hours?
  console.log(`\n\nWAIT - Are Gantt and Allocation hours being ADDED together?`);
  console.log(`Gantt hours for Jan: ${janHours.toFixed(0)}`);
  console.log(`Allocation hours for Jan (25%): 939`);
  console.log(`Sum: ${(janHours + 939).toFixed(0)} hours`);
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
