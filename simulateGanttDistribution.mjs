import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get all ProjectScopes for Giant #6582
  const scopes = await prisma.projectScope.findMany({
    where: {
      jobKey: 'Ames Construction, Inc.~2508 - GI~Giant #6582'
    },
    select: {
      id: true,
      title: true,
      hours: true,
      startDate: true,
      endDate: true,
    },
    orderBy: { title: 'asc' }
  });
  
  console.log(`Giant #6582 ProjectScopes (${scopes.length} total):\n`);
  
  let totalScopeHours = 0;
  scopes.forEach((s, idx) => {
    console.log(`[${idx + 1}] ${s.title}`);
    console.log(`    Hours: ${s.hours}`);
    console.log(`    Date Range: ${s.startDate} to ${s.endDate}`);
    totalScopeHours += s.hours || 0;
  });
  
  console.log(`\n\nTotal scope hours: ${totalScopeHours}`);
  console.log(`Project total hours: 3756`);
  console.log(`Ratio: ${(totalScopeHours / 3756).toFixed(2)}x`);
  
  // Now simulate the distribution for ALL scopes
  console.log('\n\n=== SIMULATING GANTT DISTRIBUTION ===\n');
  
  const distribution = {};
  
  scopes.forEach(scope => {
    if (!scope.startDate || !scope.endDate || !scope.hours) return;
    
    const start = new Date(scope.startDate);
    const end = new Date(scope.endDate);
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1);
    const dailyRate = scope.hours / totalDays;
    
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    const last = new Date(end.getFullYear(), end.getMonth(), 1);
    
    while (current.getTime() <= last.getTime()) {
      const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const overlapStart = start.getTime() > monthStart.getTime() ? start : monthStart;
      const overlapEnd = end.getTime() < monthEnd.getTime() ? end : monthEnd;
      const overlapDays = Math.max(0, (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24) + 1);
      
      if (overlapDays > 0) {
        if (!distribution[monthKey]) distribution[monthKey] = 0;
        distribution[monthKey] += dailyRate * overlapDays;
      }
      
      current.setMonth(current.getMonth() + 1);
    }
  });
  
  console.log('Distributed hours by month:');
  Object.entries(distribution).sort().forEach(([month, hours]) => {
    console.log(`  ${month}: ${Math.round(hours)} hours`);
  });
  
  const totalDistributed = Object.values(distribution).reduce((sum, h) => sum + h, 0);
  console.log(`\nTotal distributed: ${Math.round(totalDistributed)} hours`);
  console.log(`Should equal total scope hours: ${totalScopeHours}`);
  console.log(`Difference: ${Math.abs(totalDistributed - totalScopeHours).toFixed(2)}`);
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
