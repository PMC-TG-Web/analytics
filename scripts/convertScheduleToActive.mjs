import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get all Mondays (week starts) that fall within a given month
function getWeekStartsInMonth(year, month) {
  // month is 1-indexed (1 = January)
  const weekStarts = [];
  
  // Find first Monday of the month
  let date = new Date(year, month - 1, 1);
  while (date.getDay() !== 1) { // 1 = Monday
    date.setDate(date.getDate() + 1);
  }
  
  // Collect all Mondays that fall in this month
  while (date.getMonth() === month - 1) {
    weekStarts.push(new Date(date));
    date.setDate(date.getDate() + 7);
  }
  
  return weekStarts;
}

// Format date as YYYY-MM-DD
function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function convertScheduleToActiveSchedule() {
  console.log('\n=== Converting Monthly Allocations to Weekly Active Schedule ===\n');
  
  // Get all schedules with their allocations
  const schedules = await prisma.schedule.findMany({
    include: {
      allocationsList: true,
      project: {
        select: {
          id: true,
          hours: true
        }
      }
    }
  });
  
  console.log(`Found ${schedules.length} schedules\n`);
  
  let totalRecordsCreated = 0;
  let totalRecordsUpdated = 0;
  
  for (const schedule of schedules) {
    const allocations = schedule.allocationsList.filter(a => a.periodType === 'month');
    
    if (allocations.length === 0) continue;
    
    console.log(`Processing: ${schedule.projectName}`);
    console.log(`  Total Hours: ${schedule.totalHours || schedule.project?.hours || 0}`);
    console.log(`  Allocations: ${allocations.length}`);
    
    for (const allocation of allocations) {
      // Parse period (e.g., "2026-04")
      const [year, month] = allocation.period.split('-').map(Number);
      
      // Get all weeks (Mondays) in this month
      const weekStarts = getWeekStartsInMonth(year, month);
      
      if (weekStarts.length === 0) {
        console.log(`    ${allocation.period}: No weeks found!`);
        continue;
      }
      
      // Distribute hours evenly across weeks in the month
      const hoursPerWeek = allocation.hours / weekStarts.length;
      
      console.log(`    ${allocation.period}: ${Math.round(allocation.hours)} hours → ${weekStarts.length} weeks, ${Math.round(hoursPerWeek)}/week`);
      
      for (const weekStart of weekStarts) {
        const targetDate = formatDate(weekStart);
        const hours = hoursPerWeek;
        
        // Check if record already exists
        const existing = await prisma.activeSchedule.findUnique({
          where: {
            jobKey_scopeOfWork_date: {
              jobKey: schedule.jobKey,
              scopeOfWork: 'Monthly Allocation',
              date: targetDate
            }
          }
        });
        
        if (existing) {
          // Update existing record
          await prisma.activeSchedule.update({
            where: { id: existing.id },
            data: {
              hours: hours,
              source: 'schedules'
            }
          });
          totalRecordsUpdated++;
        } else {
          // Create new record
          await prisma.activeSchedule.create({
            data: {
              jobKey: schedule.jobKey,
              projectId: schedule.projectId,
              scopeOfWork: 'Monthly Allocation',
              date: targetDate,
              hours: hours,
              source: 'schedules'
            }
          });
          totalRecordsCreated++;
        }
      }
    }
  }
  
  console.log(`\n✓ Conversion complete!`);
  console.log(`  Created: ${totalRecordsCreated} records`);
  console.log(`  Updated: ${totalRecordsUpdated} records`);
  
  // Show summary by week
  const activeSchedules = await prisma.activeSchedule.findMany({
    where: {
      source: 'schedules'
    },
    select: {
      date: true,
      hours: true
    }
  });
  
  const byWeek = {};
  activeSchedules.forEach(s => {
    // Group by the Monday of that week
    const date = new Date(s.date);
    const dayOfWeek = date.getDay();
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(date);
    monday.setDate(monday.getDate() + daysToMonday);
    const weekKey = formatDate(monday);
    
    byWeek[weekKey] = (byWeek[weekKey] || 0) + s.hours;
  });
  
  console.log('\n=== Hours by Week Start (Active Schedule) ===');
  Object.entries(byWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([week, hours]) => {
      console.log(`  ${week}: ${Math.round(hours)} hours`);
    });
  
  await prisma.$disconnect();
}

convertScheduleToActiveSchedule().catch(console.error);
