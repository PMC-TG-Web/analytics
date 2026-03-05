const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  // Find all Broadcasting District projects
  const projects = await prisma.project.findMany({
    where: {
      projectName: { contains: 'Broadcasting District' }
    },
    select: {
      id: true,
      projectName: true,
      customer: true,
      hours: true
    }
  });

  console.log('Broadcasting District projects:');
  projects.forEach(proj => {
    console.log(`  [${proj.id}] ${proj.customer} / ${proj.projectName} - ${proj.hours} hours`);
  });

  // Find all Broadcasting District schedules
  const schedules = await prisma.schedule.findMany({
    where: {
      projectName: { contains: 'Broadcasting District' }
    },
    select: {
      id: true,
      jobKey: true,
      projectName: true,
      allocationsList: {
        select: { percent: true }
      }
    }
  });

  console.log('\nBroadcasting District schedules:');
  schedules.forEach(sched => {
    const totalPercent = sched.allocationsList.reduce((sum, a) => sum + a.percent, 0);
    console.log(`  [${sched.id}] ${sched.jobKey} - Total: ${totalPercent}% (${sched.allocationsList.length} months)`);
  });

  process.exit(0);
})();
