import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Project Status Distribution ===');
  
  // Get all unique statuses and their counts
  const statuses = await prisma.project.groupBy({
    by: ['status'],
    _count: true,
  });
  
  statuses.forEach(s => {
    console.log(`${s.status || 'NULL'}: ${s._count}`);
  });
  
  console.log('\n=== Projects with Sales > 0 ===');
  const projectsWithSales = await prisma.project.findMany({
    where: {
      AND: [
        { sales: { not: null } },
        { sales: { gt: 0 } }
      ]
    },
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      sales: true,
    },
    take: 10,
  });
  
  console.log(`Found ${projectsWithSales.length} projects with sales > 0 (showing first 10):`);
  projectsWithSales.forEach(p => {
    console.log(`  ${p.customer}~${p.projectNumber}~${p.projectName} (status: ${p.status}, sales: $${Number(p.sales).toLocaleString()})`);
  });
  
  console.log('\n=== Schedules with 2026 Allocations ===');
  
  const schedulesWithAllocations = await prisma.schedule.findMany({
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      allocationsList: {
        select: {
          period: true,
          percent: true,
          hours: true,
        },
        where: {
          period: {
            startsWith: '2026',
          }
        }
      }
    },
    take: 10,
  });
  
  const schedulesWithMatch = schedulesWithAllocations.filter(s => s.allocationsList.length > 0);
  console.log(`Found ${schedulesWithMatch.length} schedules with 2026 allocations (showing first 10):`);
  schedulesWithMatch.slice(0, 10).forEach(s => {
    const totalPercent = s.allocationsList.reduce((sum, a) => sum + (a.percent || 0), 0);
    console.log(`  jobKey: ${s.jobKey || 'NULL'}, customer: ${s.customer}, allocations: ${s.allocationsList.map(a => `${a.period}:${a.percent}%`).join(', ')} (total: ${totalPercent}%)`);
  });
  
  console.log('\n=== Matching Schedules to Projects ===');
  
  // Get projects in specific statuses
  const qualifyingProjects = await prisma.project.findMany({
    where: {
      status: {
        in: ['In Progress', 'Accepted', 'Complete']
      }
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      sales: true,
    }
  });
  
  console.log(`Projects with qualifying status: ${qualifyingProjects.length}`);
  qualifyingProjects.slice(0, 5).forEach(p => {
    console.log(`  ${p.customer}~${p.projectNumber}~${p.projectName} (status: ${p.status}, sales: $${Number(p.sales || 0).toLocaleString()})`);
  });
  
  // Now try to match
  const projectMap = new Map();
  qualifyingProjects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    projectMap.set(key, Number(p.sales || 0));
  });
  
  let totalScheduledSales = 0;
  let matchCount = 0;
  
  schedulesWithMatch.forEach(s => {
    const key = `${s.customer || ''}~${s.projectNumber || ''}~${s.projectName || ''}`;
    const projectSales = projectMap.get(key);
    
    if (projectSales) {
      matchCount++;
      s.allocationsList.forEach(alloc => {
        const monthlySales = projectSales * (alloc.percent / 100);
        totalScheduledSales += monthlySales;
      });
    }
  });
  
  console.log(`\nMatched ${matchCount} schedules to projects`);
  console.log(`Calculated 2026 Scheduled Sales: $${totalScheduledSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
