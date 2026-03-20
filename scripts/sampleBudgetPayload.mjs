import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const rows = await prisma.$queryRawUnsafe('SELECT payload FROM budgetlineitems LIMIT 2');
rows.forEach((r, i) => {
  console.log('--- Row', i + 1, '---');
  console.log(JSON.stringify(r.payload, null, 2));
});
await prisma.$disconnect();
