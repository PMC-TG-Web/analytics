import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyze() {
  console.log('\n=== Analyzing Schedule Filtering Issue ===\n');
  
  // Get all In Progress projects
  const inProgressProjects = await prisma.project.findMany({
    where: {
      status: 'In Progress',
      projectArchived: false
    },
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      hours: true,
      status: true
    }
  });
  
  console.log(`Total In Progress Projects: ${inProgressProjects.length}`);
  const totalInProgressHours = inProgressProjects.reduce((sum, p) => sum + (p.hours || 0), 0);
  console.log(`Total Hours (In Progress): ${Math.round(totalInProgressHours)}`);
  
  // Get all schedules
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
  
  console.log(`\nTotal Schedules: ${schedules.length}`);
  
  // Analyze schedules by year
  const schedulesByYear = {
    '2025': [],
    '2026': [],
    '2027': [],
    'other': []
  };
  
  schedules.forEach(schedule => {
    const allocations = schedule.allocationsList || [];
    const years = new Set();
    
    allocations.forEach(alloc => {
      const year = alloc.period.substring(0, 4);
      years.add(year);
    });
    
    if (years.has('2025')) schedulesByYear['2025'].push(schedule);
    if (years.has('2026')) schedulesByYear['2026'].push(schedule);
    if (years.has('2027')) schedulesByYear['2027'].push(schedule);
    if (years.size === 0) schedulesByYear['other'].push(schedule);
  });
  
  console.log(`\nSchedules with 2025 allocations: ${schedulesByYear['2025'].length}`);
  console.log(`Schedules with 2026 allocations: ${schedulesByYear['2026'].length}`);
  console.log(`Schedules with 2027 allocations: ${schedulesByYear['2027'].length}`);
  console.log(`Schedules with no allocations: ${schedulesByYear['other'].length}`);
  
  // Calculate hours for schedules WITH 2026 allocations
  const schedulesWith2026 = schedulesByYear['2026'];
  const hoursWith2026 = schedulesWith2026.reduce((sum, s) => {
    return sum + (s.project?.hours || s.totalHours || 0);
  }, 0);
  
  console.log(`\nProjects with 2026 allocations - Total Hours: ${Math.round(hoursWith2026)}`);
  
  // Calculate scheduled hours for 2026
  const scheduled2026 = schedulesWith2026.reduce((sum, s) => {
    const totalHours = s.project?.hours || s.totalHours || 0;
    const allocations = s.allocationsList.filter(a => a.period.startsWith('2026'));
    const totalPercent = allocations.reduce((pSum, a) => pSum + (a.percent || 0), 0);
    const scheduledHours = totalHours * (totalPercent / 100);
    return sum + scheduledHours;
  }, 0);
  
  console.log(`Scheduled Hours in 2026: ${Math.round(scheduled2026)}`);
  console.log(`Unscheduled (2026 filter): ${Math.round(hoursWith2026 - scheduled2026)}`);
  
  // Calculate scheduled hours for all time
  const scheduledAllTime = schedules.reduce((sum, s) => {
    const totalHours = s.project?.hours || s.totalHours || 0;
    const allocations = s.allocationsList;
    const totalPercent = allocations.reduce((pSum, a) => pSum + (a.percent || 0), 0);
    const scheduledHours = totalHours * (totalPercent / 100);
    return sum + scheduledHours;
  }, 0);
  
  const totalScheduledProjectHours = schedules.reduce((sum, s) => {
    return sum + (s.project?.hours || s.totalHours || 0);
  }, 0);
  
  console.log(`\nAll Time Scheduled Hours: ${Math.round(scheduledAllTime)}`);
  console.log(`Total Hours (projects with schedules): ${Math.round(totalScheduledProjectHours)}`);
  console.log(`Unscheduled (no filter): ${Math.round(totalScheduledProjectHours - scheduledAllTime)}`);
  
  // Check for In Progress projects WITHOUT schedules
  const scheduleJobKeys = new Set(schedules.map(s => s.jobKey));
  const projectsWithoutSchedules = inProgressProjects.filter(p => {
    const jobKey = `${p.customer}~${p.projectNumber}~${p.projectName}`;
    return !scheduleJobKeys.has(jobKey);
  });
  
  console.log(`\n=== Projects WITHOUT Schedules ===`);
  console.log(`Count: ${projectsWithoutSchedules.length}`);
  if (projectsWithoutSchedules.length > 0) {
    const hoursWithoutSchedules = projectsWithoutSchedules.reduce((sum, p) => sum + (p.hours || 0), 0);
    console.log(`Total Hours: ${Math.round(hoursWithoutSchedules)}`);
    console.log('\nFirst 10 projects:');
    projectsWithoutSchedules.slice(0, 10).forEach(p => {
      console.log(`  - ${p.customer} / ${p.projectName} (${p.hours || 0} hours)`);
    });
  }
  
  await prisma.$disconnect();
}

analyze().catch(console.error);
