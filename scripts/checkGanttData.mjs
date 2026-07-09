import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  // Check gantt_v2 tables
  const ganttCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "GanttV2Project"`).catch(() => null);
  const scopeCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "GanttV2Scope"`).catch(() => null);
  const entryCount = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "gantt_v2_schedule_entries"`).catch(() => null);
  const scheduleCount = await prisma.schedule.count().catch(() => null);

  console.log('GanttV2Project rows:', ganttCount?.[0]?.count ?? 'table missing');
  console.log('GanttV2Scope rows:', scopeCount?.[0]?.count ?? 'table missing');
  console.log('gantt_v2_schedule_entries rows:', entryCount?.[0]?.count ?? 'table missing');
  console.log('Schedule (short-term docs) rows:', scheduleCount ?? 'table missing');

  // Sample gantt schedule entries
  const entries = await prisma.$queryRawUnsafe(
    `SELECT "jobKey", "scopeId", "date", "hours", "source", "createdAt" 
     FROM "gantt_v2_schedule_entries" 
     ORDER BY "date" DESC LIMIT 10`
  ).catch(() => []);
  console.log('\nSample gantt_v2_schedule_entries (last 10):');
  console.log(JSON.stringify(entries, null, 2));

  // Check scopes with dates  
  const scopes = await prisma.$queryRawUnsafe(
    `SELECT "jobKey", "startDate", "endDate", "totalHours", "status"
     FROM "GanttV2Scope"
     WHERE "startDate" IS NOT NULL
     ORDER BY "startDate" DESC LIMIT 10`
  ).catch(() => []);
  console.log('\nSample GanttV2Scope with dates (last 10):');
  console.log(JSON.stringify(scopes, null, 2));

} finally {
  await prisma.$disconnect();
}
