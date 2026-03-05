import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.activeSchedule.findMany({
    where: {
      OR: [
        { scopeOfWork: { contains: 'Help' } },
        { scopeOfWork: { contains: 'help' } },
        { scopeOfWork: { contains: 'Jason' } },
      ],
    },
    orderBy: [{ date: 'desc' }],
    take: 25,
    select: {
      jobKey: true,
      scopeOfWork: true,
      date: true,
      hours: true,
      foreman: true,
      source: true,
    },
  });

  console.log(rows);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
