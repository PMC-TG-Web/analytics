import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const rows = await p.budgetLineItem.findMany({ select: { costCodeDescription: true }, distinct: ['costCodeDescription'], take: 60, orderBy: { costCodeDescription: 'asc' } });
rows.forEach(x => console.log(x.costCodeDescription));
await p.$disconnect();
