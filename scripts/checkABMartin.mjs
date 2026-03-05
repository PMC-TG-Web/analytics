import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const s = await prisma.schedule.findFirst({
  where: {
    projectName: { contains: 'AB Martin 34 Denver' }
  },
  include: {
    allocationsList: true,
    project: {
      select: { hours: true }
    }
  }
});

console.log('Project:', s.projectName);
console.log('Total Hours:', s.project.hours);
console.log('\nAllocations:');
s.allocationsList.forEach(a => {
  console.log(`  ${a.period}: ${a.percent}% (${a.hours} hours)`);
});

const totalPercent = s.allocationsList.reduce((sum, a) => sum + a.percent, 0);
console.log('\nTotal allocated:', totalPercent + '%');

await prisma.$disconnect();
