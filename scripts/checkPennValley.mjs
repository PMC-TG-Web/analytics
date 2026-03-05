import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const schedule = await prisma.schedule.findFirst({
  where: {
    projectName: { contains: 'Penn Valley Gas' }
  },
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

if (!schedule) {
  console.log('Schedule not found');
} else {
  console.log('Project:', schedule.projectName);
  console.log('Status:', schedule.status);
  console.log('Project Hours:', schedule.project?.hours);
  console.log('Schedule Total Hours:', schedule.totalHours);
  
  console.log('\nAllocations:');
  schedule.allocationsList.forEach(a => {
    console.log(`  ${a.period}: ${a.percent}% (${a.hours} hours)`);
  });
  
  const totalPercent = schedule.allocationsList.reduce((sum, a) => sum + a.percent, 0);
  console.log('\nTotal allocated:', totalPercent + '%');
  
  const has2026 = schedule.allocationsList.some(a => a.period.startsWith('2026'));
  console.log('Has 2026 allocations:', has2026);
  
  const has2025 = schedule.allocationsList.some(a => a.period.startsWith('2025'));
  console.log('Has 2025 allocations:', has2025);
}

await prisma.$disconnect();
