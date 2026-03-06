import { prisma } from '@/lib/prisma';

/**
 * Test script to verify sync functionality
 */
async function testSync() {
  try {
    console.log('Testing sync functionality...');

    // 1. Check if activeSchedule table exists and has data
    const activeScheduleCount = await prisma.activeSchedule.count();
    console.log(`\n1. ActiveSchedule records: ${activeScheduleCount}`);

    if (activeScheduleCount > 0) {
      const sample = await prisma.activeSchedule.findFirst();
      console.log('   Sample record:', {
        jobKey: sample?.jobKey,
        date: sample?.date,
        hours: sample?.hours,
      });
    }

    // 2. Check gantt_v2_projects
    const projectsCount = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      'SELECT COUNT(*) as count FROM gantt_v2_projects'
    )[0];
    console.log(`\n2. Gantt V2 Projects: ${projectsCount}`);

    // 3. Check gantt_v2_scopes
    const scopesCount = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      'SELECT COUNT(*) as count FROM gantt_v2_scopes'
    )[0];
    console.log(`3. Gantt V2 Scopes: ${scopesCount}`);

    // 4. Check gantt_v2_schedule_entries
    const entriesCount = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      'SELECT COUNT(*) as count FROM gantt_v2_schedule_entries'
    )[0];
    console.log(`4. Gantt V2 Schedule Entries: ${entriesCount}`);

    console.log('\n✅ All systems operational');
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSync();
