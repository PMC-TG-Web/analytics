import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function simulateFrontendCalc() {
  console.log('\n=== Simulating Frontend Calculations ===\n');
  
  // Get all projects (like uniqueJobs)
  const allProjects = await prisma.project.findMany({
    where:{
      projectArchived: false,
      status: 'In Progress',  // qualifyingStatuses
    },
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      hours: true
    }
  });
  
  console.log(`Total In Progress Projects (uniqueJobs): ${allProjects.length}`);
  
  // Get all schedules
  const allSchedules = await prisma.schedule.findMany({
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
  
  console.log(`Total Schedules: ${allSchedules.length}`);
  
  // Filter schedules by status (In Progress only) - this is like filteredSchedules in allJobs
  const inProgressSchedules = allSchedules.filter(s => s.status === 'In Progress');
  console.log(`In Progress Schedules: ${inProgressSchedules.length}`);
  
  const completeSchedules = allSchedules.filter(s => s.status === 'Complete');
  console.log(`Complete Schedules: ${completeSchedules.length}`);
  
  console.log('\n=== WITHOUT Year Filter ===\n');
  
  // All In Progress schedules
  let allJobsNoFilter = [...inProgressSchedules];
  
  // Add In Progress projects without schedules
  const scheduleJobKeys = new Set(allSchedules.map(s => s.jobKey));
  const projectsWithoutSchedules = allProjects.filter(p => {
    const jobKey = `${p.customer}~${p.projectNumber}~${p.projectName}`;
    return !scheduleJobKeys.has(jobKey);
  });
  
  allJobsNoFilter.push(...projectsWithoutSchedules.map(p => ({
    jobKey: `${p.customer}~${p.projectNumber}~${p.projectName}`,
    status: p.status,
    totalHours: p.hours || 0,
    allocationsList: []
  })));
  
  console.log(`allJobs count: ${allJobsNoFilter.length}`);
  
  // Calculate qualifying hours
  const qualifyingHoursNoFilter = allJobsNoFilter.reduce((sum, job) => {
    if (job.status !== 'In Progress') return sum;
    const hours = job.project?.hours || job.totalHours || 0;
    return sum + hours;
  }, 0);
  
  console.log(`Qualifying Hours: ${Math.round(qualifyingHoursNoFilter)}`);
  
  // Calculate scheduled hours (all time)
  const scheduledHoursNoFilter = inProgressSchedules.reduce((sum, s) => {
    const totalHours = s.project?.hours || s.totalHours || 0;
    const totalPercent = s.allocationsList.reduce((pSum, a) => pSum + (a.percent || 0), 0);
    return sum + (totalHours * (totalPercent / 100));
  }, 0);
  
  console.log(`Scheduled Hours: ${Math.round(scheduledHoursNoFilter)}`);
  console.log(`Unscheduled Hours: ${Math.round(qualifyingHoursNoFilter - scheduledHoursNoFilter)}`);
  
  console.log('\n=== WITH 2026 Year Filter ===\n');
  
  // Filter schedules with 2026 allocations only
  const schedulesWith2026 = inProgressSchedules.filter(s => {
    return s.allocationsList.some(a => a.period.startsWith('2026'));
  });
  
  console.log(`Schedules with 2026 allocations: ${schedulesWith2026.length}`);
  
  let allJobs2026 = [...schedulesWith2026];
  
  // Add In Progress projects without schedules (same as no filter)
  allJobs2026.push(...projectsWithoutSchedules.map(p => ({
    jobKey: `${p.customer}~${p.projectNumber}~${p.projectName}`,
    status: p.status,
    totalHours: p.hours || 0,
    allocationsList: []
  })));
  
  console.log(`allJobs count: ${allJobs2026.length}`);
  
  // Calculate qualifying hours (2026)
  const qualifyingHours2026 = allJobs2026.reduce((sum, job) => {
    if (job.status !== 'In Progress') return sum;
    const hours = job.project?.hours || job.totalHours || 0;
    return sum + hours;
  }, 0);
  
  console.log(`Qualifying Hours: ${Math.round(qualifyingHours2026)}`);
  
  // Calculate scheduled hours (2026 only)
  const scheduledHours2026 = schedulesWith2026.reduce((sum, s) => {
    const totalHours = s.project?.hours || s.totalHours || 0;
    const allocations2026 = s.allocationsList.filter(a => a.period.startsWith('2026'));
    const totalPercent = allocations2026.reduce((pSum, a) => pSum + (a.percent || 0), 0);
    return sum + (totalHours * (totalPercent / 100));
  }, 0);
  
  console.log(`Scheduled Hours (2026 only): ${Math.round(scheduledHours2026)}`);
  console.log(`Unscheduled Hours: ${Math.round(qualifyingHours2026 - scheduledHours2026)}`);
  
  // Debug: show schedules without 2026 allocations
  const schedulesNo2026 = inProgressSchedules.filter(s => {
    return !s.allocationsList.some(a => a.period.startsWith('2026'));
  });
  
  if (schedulesNo2026.length > 0) {
    console.log(`\n=== In Progress Schedules WITHOUT 2026 Allocations ===`);
    console.log(`Count: ${schedulesNo2026.length}`);
    const hoursNo2026 = schedulesNo2026.reduce((sum, s) => sum + (s.project?.hours || s.totalHours || 0), 0);
    console.log(`Total Hours: ${Math.round(hoursNo2026)}`);
    schedulesNo2026.forEach(s => {
      const hours = s.project?.hours || s.totalHours || 0;
      const years = new Set(s.allocationsList.map(a => a.period.substring(0, 4)));
      console.log(`  - ${s.projectName} (${Math.round(hours)} hours, years: ${Array.from(years).join(', ')})`);
    });
  }
  
  await prisma.$disconnect();
}

simulateFrontendCalc().catch(console.error);
