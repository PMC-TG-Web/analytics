import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const p = await prisma.project.findFirst({
  where: {
    projectName: { contains: 'Paneling Sales Pine' }
  }
});

if (!p) {
  console.log('Project not found');
} else {
  console.log('Project:', p.projectName);
  console.log('Customer:', p.customer);
  console.log('Project Number:', p.projectNumber);
  console.log('Status:', p.status);
  console.log('Hours:', p.hours);
  console.log('Sales:', p.sales);
  console.log('Cost:', p.cost);
  console.log('Archived:', p.projectArchived);
}

// Also check if there's a schedule for it
const schedule = await prisma.schedule.findFirst({
  where: {
    projectName: { contains: 'Paneling Sales Pine' }
  },
  include: {
    allocationsList: true
  }
});

if (schedule) {
  console.log('\nSchedule found:');
  console.log('Total Hours:', schedule.totalHours);
  console.log('Status:', schedule.status);
  console.log('Allocations:');
  schedule.allocationsList.forEach(a => {
    console.log(`  ${a.period}: ${a.percent}% (${a.hours} hours)`);
  });
  const totalPercent = schedule.allocationsList.reduce((sum, a) => sum + a.percent, 0);
  console.log('Total allocated:', totalPercent + '%');
} else {
  console.log('\nNo schedule found');
}

await prisma.$disconnect();
