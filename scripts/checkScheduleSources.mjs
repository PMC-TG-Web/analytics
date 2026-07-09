import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const sources = await prisma.activeSchedule.groupBy({
    by: ['source'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });
  console.log('Source distribution:');
  for (const s of sources) console.log(`  "${s.source ?? 'null'}" → ${s._count.id} rows`);

  const total = await prisma.activeSchedule.count();
  console.log(`\nTotal activeSchedule rows: ${total}`);

  // Sample non-gantt entries
  const nonGantt = await prisma.activeSchedule.findMany({
    where: { source: { notIn: ['gantt', 'wip-page'] } },
    select: { id: true, jobKey: true, source: true, date: true, hours: true },
    take: 10,
    orderBy: { date: 'desc' },
  });
  console.log('\nSample non-gantt entries (up to 10):');
  console.log(JSON.stringify(nonGantt, null, 2));
} finally {
  await prisma.$disconnect();
}
