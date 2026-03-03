import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const schedId = 'cmm9kly3h0038e3os3z9v73oz';
  
  const sched = await prisma.schedule.findUnique({
    where: { id: schedId },
    include: { allocationsList: true }
  });
  
  console.log(`Schedule: ${sched?.jobKey}`);
  console.log(`Total allocations in DB: ${sched?.allocationsList?.length || 0}`);
  sched?.allocationsList?.forEach(a => {
    console.log(`  ${a.period}: ${a.percent}% (${a.hours} hours)`);
  });
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
