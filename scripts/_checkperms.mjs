import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const u = await prisma.user.findUnique({ where: { email: 'todd@pmcdecor.com' }, select: { email: true, permissions: true } });
console.log(JSON.stringify(u, null, 2));
await prisma.$disconnect();
