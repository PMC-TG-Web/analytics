import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const result = await prisma.productivityLog.deleteMany({});
console.log('Deleted rows:', result.count);
await prisma.$disconnect();
