import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  const jobKey = 'Heck Construction~2512 - GFS~Gish Furniture Sitework';
  
  // Get the scopes
  const scopes = await prisma.projectScope.findMany({
    where: {
      jobKey: jobKey
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
  
  console.log(`Gish Furniture Sitework ProjectScopes (${scopes.length} total):\n`);
  
  scopes.forEach((s, idx) => {
    console.log(`[${idx + 1}] ${s.title}`);
    console.log(`    Hours: ${s.hours}`);
    console.log(`    Date Range: ${s.startDate} to ${s.endDate}`);
  });
  
  // Simulate the distribution  console.log('\n\n=== SIMULATING GANTT DISTRIBUTION (Frontend Logic) ===\n');
  
  const distribution = {};
  
  scopes.forEach((scope, scopeIdx) => {
    if (!scope.startDate || !scope.endDate || !scope.hours) return;
    
    console.log(`\nProcessing scope ${scopeIdx + 1}: "${scope.title}" (${scope.hours}h)`);
    
    const start = new Date(scope.startDate);
    const end = new Date(scope.endDate);
    const totalDays = Math.max(1, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24) + 1);
    const dailyRate = scope.hours / totalDays;
    
    console.log(`  Total days: ${totalDays}, Daily rate: ${dailyRate.toFixed(2)}`);
    
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
        const monthHours = dailyRate * overlapDays;
        console.log(`  ${monthKey}: ${Math.round(monthHours)}h (${overlapDays} days)`);
        if (!distribution[monthKey]) distribution[monthKey] = 0;
        distribution[monthKey] += monthHours;
      }
      
      current.setMonth(current.getMonth() + 1);
    }
  });
  
  console.log('\n\nFinal distribution (sum of all scopes):');
  Object.entries(distribution).sort().forEach(([month, hours]) => {
    console.log(`  ${month}: ${Math.round(hours)} hours`);
  });
  
  const totalDistributed = Object.values(distribution).reduce((sum, h) => sum + h, 0);
  console.log(`\nTotal distributed: ${Math.round(totalDistributed)} hours`);
  
  // Compare with screenshot
  console.log('\n\n=== COMPARISON WITH SCREENSHOT ===');
  console.log('Screenshot shows:');
  console.log('  Mar 2026: 533 hrs GANTT');
  console.log('  Apr 2026: 530 hrs GANTT');
  console.log('  May 2026: 548 hrs GANTT');
  console.log('  Jun 2026: 530 hrs GANTT');
  console.log('  Total: 2141 hrs');
  console.log('');
  console.log('Database should show:');
  console.log(`  Mar 2026: ${Math.round(distribution['2026-03'] || 0)} hrs`);
  console.log(`  Apr 2026: ${Math.round(distribution['2026-04'] || 0)} hrs`);
  console.log(`  May 2026: ${Math.round(distribution['2026-05'] || 0)} hrs`);
  console.log(`  Jun 2026: ${Math.round(distribution['2026-06'] || 0)} hrs`);
  console.log(`  Total: ${Math.round(totalDistributed)} hrs`);
  console.log('');
  console.log(`Multiplier: ${(2141 / totalDistributed).toFixed(2)}x`);
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
