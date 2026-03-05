import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function syncScheduleStatus() {
  console.log('\n=== Syncing Schedule Status with Project Status ===\n');
  
  const schedules = await prisma.schedule.findMany({
    include: {
      project: {
        select: {
          status: true
        }
      }
    }
  });
  
  console.log(`Total schedules: ${schedules.length}\n`);
  
  let updated = 0;
  let missingProjects = 0;
  
  for (const schedule of schedules) {
    if (!schedule.project) {
      console.log(`⚠️  Schedule ${schedule.jobKey} has no linked project!`);
      missingProjects++;
      continue;
    }
    
    const projectStatus = schedule.project.status;
    const scheduleStatus = schedule.status;
    
    if (projectStatus !== scheduleStatus) {
      console.log(`Updating ${schedule.projectName}: ${scheduleStatus} → ${projectStatus}`);
      await prisma.schedule.update({
        where: { id: schedule.id },
        data: { status: projectStatus }
      });
      updated++;
    }
  }
  
  console.log(`\n✓ Updated ${updated} schedules`);
  console.log(`⚠️  Found ${missingProjects} schedules without linked projects`);
  
  // Show summary by status after sync
  const schedulesAfter = await prisma.schedule.findMany({
    select: {
      status: true,
      totalHours: true
    }
  });
  
  const byStatus = {};
  schedulesAfter.forEach(s => {
    const status = s.status || 'Unknown';
    if (!byStatus[status]) {
      byStatus[status] = { count: 0, hours: 0 };
    }
    byStatus[status].count++;
    byStatus[status].hours += s.totalHours || 0;
  });
  
  console.log('\n=== Schedules by Status (after sync) ===');
  Object.entries(byStatus).forEach(([status, data]) => {
    console.log(`${status}: ${data.count} schedules (${Math.round(data.hours)} hours)`);
  });
  
  await prisma.$disconnect();
}

syncScheduleStatus().catch(console.error);
