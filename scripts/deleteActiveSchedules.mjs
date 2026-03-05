import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteActiveSchedules() {
  console.log('Deleting all ActiveSchedule records...\n');

  const deletedCount = await prisma.activeSchedule.deleteMany({});
  console.log(`✓ Deleted ${deletedCount.count} ActiveSchedule records`);

  const remaining = await prisma.activeSchedule.count();
  console.log(`\nRemaining ActiveSchedule records: ${remaining}`);

  console.log(`\n✓ Complete clean slate - only Project.hours remain`);

  await prisma.$disconnect();
  process.exit(0);
}

deleteActiveSchedules().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
