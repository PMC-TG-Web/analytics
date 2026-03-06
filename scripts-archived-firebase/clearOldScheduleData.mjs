import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearOldScheduleData() {
  console.log('\n=== Clearing Old Schedule Data ===\n');
  
  // Delete all activeSchedule records with source='schedules'
  const deleted = await prisma.activeSchedule.deleteMany({
    where: {
      source: 'schedules'
    }
  });
  
  console.log(`✓ Deleted ${deleted.count} old activeSchedule records`);
  
  await prisma.$disconnect();
}

clearOldScheduleData().catch(console.error);
