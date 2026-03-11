const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.project.findMany({ select: { customer: true } });
  const counts = {
    'sop inc': 0,
    'paradise masonry, llc': 0,
    'raymond king': 0,
  };

  for (const r of rows) {
    const c = (r.customer || '').toLowerCase().trim();
    if (c === 'paradise masonry, llc') counts['paradise masonry, llc']++;
    if (c === 'raymond king') counts['raymond king']++;
    if (c === 'sop inc' || c === 'sop, inc' || c.includes('sop inc')) counts['sop inc']++;
  }

  console.log(counts);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
