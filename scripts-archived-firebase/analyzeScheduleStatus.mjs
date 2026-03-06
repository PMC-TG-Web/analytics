import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyze() {
  console.log('\n=== Schedule Status Analysis ===\n');
  
  const schedules = await prisma.schedule.findMany({
    include: {
      allocationsList: true,
      project: {
        select: {
          hours: true,
          status: true
        }
      }
    }
  });
  
  console.log(`Total Schedules: ${schedules.length}\n`);
  
  // Group by project status
  const byStatus = {};
  let totalHoursInProgress = 0;
  let totalHoursOtherStatus = 0;
  
  schedules.forEach(s => {
    const status = s.project?.status || s.status || 'Unknown';
    if (!byStatus[status]) {
      byStatus[status] = {
        count: 0,
        hours: 0,
        with2026: 0,
        hours2026: 0
      };
    }
    byStatus[status].count++;
    const hours = s.project?.hours || s.totalHours || 0;
    byStatus[status].hours += hours;
    
    // Check for 2026 allocations
    const has2026 = s.allocationsList.some(a => a.period.startsWith('2026'));
    if (has2026) {
      byStatus[status].with2026++;
      byStatus[status].hours2026 += hours;
    }
    
    if (status === 'In Progress') {
      totalHoursInProgress += hours;
    } else {
      totalHoursOtherStatus += hours;
    }
  });
  
  console.log('Schedules by Project Status:');
  Object.entries(byStatus).forEach(([status, data]) => {
    console.log(`\n${status}:`);
    console.log(`  Total: ${data.count} schedules (${Math.round(data.hours)} hours)`);
    console.log(`  With 2026 allocations: ${data.with2026} schedules (${Math.round(data.hours2026)} hours)`);
  });
  
  console.log(`\n=== Summary ===`);
  console.log(`In Progress schedules: ${Math.round(totalHoursInProgress)} hours`);
  console.log(`Other status schedules: ${Math.round(totalHoursOtherStatus)} hours`);
  
  // Find schedules without matching In Progress projects
  const inProgressProjects = await prisma.project.findMany({
    where: {
      status: 'In Progress',
      projectArchived: false
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      hours: true
    }
  });
  
  const inProgressJobKeys = new Set(
    inProgressProjects.map(p => `${p.customer}~${p.projectNumber}~${p.projectName}`)
  );
  
  const schedulesNotInProgress = schedules.filter(s => {
    return !inProgressJobKeys.has(s.jobKey);
  });
  
  console.log(`\n=== Schedules NOT matching In Progress projects ===`);
  console.log(`Count: ${schedulesNotInProgress.length}`);
  schedulesNotInProgress.forEach(s => {
    const hours = s.project?.hours || s.totalHours || 0;
    const status = s.project?.status || s.status || 'Unknown';
    const has2026 = s.allocationsList.some(a => a.period.startsWith('2026'));
    console.log(`  - ${s.projectName} (${status}, ${Math.round(hours)} hours, 2026: ${has2026})`);
  });
  
  await prisma.$disconnect();
}

analyze().catch(console.error);
