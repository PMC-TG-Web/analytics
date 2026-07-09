import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const tables = [
    ['ProjectScope', () => prisma.projectScope.count()],
    ['Project', () => prisma.project.count()],
    ['Employee', () => prisma.employee.count()],
    ['Schedule', () => prisma.schedule.count()],
    ['ActiveSchedule', () => prisma.activeSchedule.count()],
    ['TimeOffRequest', () => prisma.timeOffRequest.count()],
    ['ScheduleAllocation', () => prisma.scheduleAllocation.count().catch(() => 'N/A')],
  ];

  for (const [name, fn] of tables) {
    const count = await fn().catch(e => `ERROR: ${e.message.split('\n')[0]}`);
    console.log(`${name}: ${count}`);
  }

  // Also check raw table list
  const allTables = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log('\nAll public tables:');
  console.log(allTables.map(t => `  ${t.tablename}`).join('\n'));

} finally {
  await prisma.$disconnect();
}
