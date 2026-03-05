import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get all "In Progress" projects
  const projects = await prisma.project.findMany({
    where: {
      status: 'In Progress',
      projectArchived: false,
    },
    select: {
      projectName: true,
      customer: true,
      hours: true,
    }
  });
  
  console.log(`Total "In Progress" projects: ${projects.length}\n`);
  
  // Get all jobs with allocated schedules
  const schedules = await prisma.schedule.findMany({
    where: {
      status: 'In Progress'
    },
    select: {
      jobKey: true,
      projectName: true,
      customer: true,
      totalHours: true,
      allocationsList: {
        select: {
          period: true,
          percent: true,
        },
        where: {
          period: { startsWith: '2026' }
        }
      }
    }
  });
  
  const scheduledJobKeys = new Set(schedules.map(s => s.jobKey));
  console.log(`Projects WITH schedule allocations: ${scheduledJobKeys.size}\n`);
  
  // Find projects WITHOUT any schedule
  const unscheduledProjects = projects.filter(p => {
    const jobKey = `${p.customer || ''}~${'' || ''}~${p.projectName || ''}`;
    return !Array.from(scheduledJobKeys).some(key => key.includes(p.projectName));
  });
  
  console.log(`Projects WITHOUT schedules: ${unscheduledProjects.length}\n`);
  
  if (unscheduledProjects.length > 0) {
    console.log('Unscheduled projects:');
    let totalUnscheduledHours = 0;
    unscheduledProjects.forEach((p) => {
      console.log(`  ${p.customer} - ${p.projectName}: ${p.hours}h`);
      totalUnscheduledHours += p.hours || 0;
    });
    console.log(`\nTotal unscheduled hours: ${totalUnscheduledHours}`);
  }
  
  // Also check for projects with partial schedules (under 100%)
  console.log(`\n\n=== PROJECTS WITH PARTIAL ALLOCATION (< 100%) ===\n`);
  
  let partiallyScheduledCount = 0;
  let partiallyScheduledHours = 0;
  
  schedules.forEach(s => {
    const total2026Percent = s.allocationsList.reduce((sum, alloc) => sum + (alloc.percent || 0), 0);
    
    if (total2026Percent < 100 && total2026Percent > 0) {
      const unallocatedPercent = 100 - total2026Percent;
      const unallocatedHours = (s.totalHours || 0) * (unallocatedPercent / 100);
      console.log(`${s.customer} - ${s.projectName}`);
      console.log(`  Total hours: ${s.totalHours}`);
      console.log(`  Allocated: ${total2026Percent}% (${(s.totalHours || 0) * (total2026Percent / 100)}h)`);
      console.log(`  Unallocated: ${unallocatedPercent}% (${unallocatedHours.toFixed(0)}h)\n`);
      partiallyScheduledCount++;
      partiallyScheduledHours += unallocatedHours;
    }
  });
  
  if (partiallyScheduledCount > 0) {
    console.log(`\nTotal unscheduled hours from partial allocation: ${partiallyScheduledHours.toFixed(0)}`);
  } else {
    console.log('No projects with partial allocation found');
  }
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
