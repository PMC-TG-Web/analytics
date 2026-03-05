import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkGanttData() {
  try {
    console.log('\n=== Checking Gantt Project Data ===\n');

    // Count total projects
    const totalProjects = await prisma.project.count();
    console.log(`Total Projects: ${totalProjects}`);

    // Count In Progress projects
    const inProgressProjects = await prisma.project.count({
      where: { status: 'In Progress' }
    });
    console.log(`In Progress Projects: ${inProgressProjects}`);

    // Count ProjectScope entries
    const totalScopes = await prisma.projectScope.count();
    console.log(`Total ProjectScope entries: ${totalScopes}`);

    // Count ScheduleAllocation entries (WIP3 monthly data)
    const totalAllocations = await prisma.scheduleAllocation.count();
    console.log(`Total ScheduleAllocation entries: ${totalAllocations}`);

    // Get schedules with allocations
    const schedulesWithAllocations = await prisma.schedule.findMany({
      include: {
        allocationsList: true
      }
    });
    console.log(`\nSchedules with allocations: ${schedulesWithAllocations.length}`);

    // Show first 10 projects with allocations
    console.log('\nFirst 10 projects with monthly allocations:');
    schedulesWithAllocations.slice(0, 10).forEach(schedule => {
      const totalHours = schedule.allocationsList.reduce((sum, a) => sum + (a.hours || 0), 0);
      const periods = schedule.allocationsList.map(a => a.period).join(', ');
      console.log(`  ${schedule.jobKey}: ${totalHours.toFixed(0)} hours`);
      console.log(`    Periods: ${periods}`);
    });

    // Check ProjectScope with dates
    const scopesWithDates = await prisma.projectScope.findMany({
      where: {
        AND: [
          { startDate: { not: null } },
          { startDate: { not: '' } }
        ]
      },
      select: { jobKey: true, title: true, startDate: true, endDate: true, hours: true }
    });
    console.log(`\nProjectScopes with start dates: ${scopesWithDates.length}`);
    if (scopesWithDates.length > 0) {
      console.log('Examples:');
      scopesWithDates.slice(0, 5).forEach(scope => {
        console.log(`  ${scope.jobKey} - ${scope.title}: ${scope.startDate} to ${scope.endDate} (${scope.hours} hrs)`);
      });
    }

    console.log('\n=== Summary ===');
    console.log(`Projects that SHOULD appear on Gantt:`);
    console.log(`  - From monthly allocations: ${schedulesWithAllocations.length} projects`);
    console.log(`  - From scopes with dates: ${scopesWithDates.length} projects`);
    console.log(`  - Total unique: ${new Set([...schedulesWithAllocations.map(s => s.jobKey), ...scopesWithDates.map(s => s.jobKey)]).size}`);


  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkGanttData();
