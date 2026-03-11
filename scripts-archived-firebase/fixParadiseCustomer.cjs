/**
 * fixParadiseCustomer.cjs
 * Finds projects with customer "Paradise Masonry, LLC" and neutralizes them
 * from analytics by archiving and renaming customer.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const target = 'Paradise Masonry, LLC';

  const rows = await prisma.project.findMany({
    where: { customer: target },
    select: { id: true, projectName: true, status: true, hours: true, projectArchived: true, customer: true },
  });

  console.log(`Found ${rows.length} projects with customer \"${target}\"`);
  rows.forEach((r) => {
    console.log(`- ${r.projectName} | status=${r.status || 'Unknown'} | hours=${r.hours || 0} | archived=${Boolean(r.projectArchived)}`);
  });

  if (rows.length === 0) {
    console.log('No changes needed.');
    return;
  }

  const ids = rows.map(r => r.id);

  await prisma.project.updateMany({
    where: { id: { in: ids } },
    data: {
      projectArchived: true,
      customer: 'UNKNOWN',
    },
  });

  const verify = await prisma.project.count({ where: { customer: target } });
  console.log(`Remaining projects with customer \"${target}\": ${verify}`);

  const unknownArchived = await prisma.project.count({ where: { id: { in: ids }, customer: 'UNKNOWN', projectArchived: true } });
  console.log(`Updated rows now archived+UNKNOWN: ${unknownArchived}/${ids.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
