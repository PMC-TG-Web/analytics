import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupDuplicates() {
  const idsToDelete = [
    'cmmakdw6u0001e3fgng8dkfmn', // abmartin old
    'cmmakdwo9000je3fg9d8hq8bw', // ccsbuildinggroup MCMB old
    'cmmakdwv0000re3fg0f00h3gx', // ccsbuildinggroup MC3A old
    'cmmakdx0c000xe3fg4joqq0fn', // warfelconstruction old
    'cmmakdx23000ze3fgbw63l9iq', // cgaconstruction TLE old
    'cmmakdx5l0013e3fgys7pziqw', // cgaconstruction WCFB old
  ];

  console.log('Deleting old duplicate schedules:', idsToDelete.length);

  for (const id of idsToDelete) {
    // First, delete associated allocations
    await prisma.scheduleAllocation.deleteMany({
      where: { scheduleId: id }
    });
    console.log(`  Deleted allocations for schedule ${id}`);

    // Then delete the schedule
    await prisma.schedule.delete({
      where: { id }
    });
    console.log(`  Deleted schedule ${id}`);
  }

  console.log('\nCleanup complete!');
  
  // Verify
  const remaining = await prisma.schedule.count();
  console.log(`Schedules remaining: ${remaining}`);

  await prisma.$disconnect();
  process.exit(0);
}

cleanupDuplicates().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
