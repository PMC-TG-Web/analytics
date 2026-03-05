const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const schedules = await prisma.schedule.findMany({
    where: {
      OR: [
        { customer: null },
        { customer: '' },
        { projectName: null },
        { projectName: '' }
      ]
    },
    select: { id: true, jobKey: true, customer: true, projectName: true, totalHours: true, status: true }
  });
  console.log('Schedules with missing customer/project:');
  schedules.forEach(s => {
    console.log(`  [${s.id}] ${s.jobKey} - Customer: '${s.customer}' / Project: '${s.projectName}' - Hours: ${s.totalHours}`);
  });
  
  // Also look for any with 2000 hours
  const hours2k = await prisma.schedule.findMany({
    where: { totalHours: 2000 },
    select: { id: true, jobKey: true, customer: true, projectName: true, totalHours: true, status: true }
  });
  console.log('\nSchedules with exactly 2000 hours:');
  hours2k.forEach(s => {
    console.log(`  [${s.id}] ${s.jobKey} - Customer: '${s.customer}' / Project: '${s.projectName}'`);
  });
  
  process.exit(0);
})();
