import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkWarfel() {
  const schedules = await prisma.schedule.findMany({
    where: {
      customer: 'Warfel Construction',
      projectName: 'Tel Hai Health Center'
    }
  });
  
  console.log('Schedules found:', schedules.length);
  schedules.forEach((s, i) => {
    console.log(`[${i+1}] id=${s.id}, jobKey=${s.jobKey}`);
  });

  if (schedules.length === 1) {
    console.log('\n✓ Duplicate removed! Only one schedule remains.');
  }

  await prisma.$disconnect();
  process.exit(0);
}

checkWarfel().catch(err => {
  console.error(err);
  process.exit(1);
});
