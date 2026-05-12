import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const email = 'todd@pmcdecor.com';
const result = await prisma.user.upsert({
  where: { email },
  update: { permissions: ['OWNER'], isActive: true },
  create: { email, permissions: ['OWNER'], isActive: true },
});
console.log('Upserted:', JSON.stringify(result, null, 2));

const all = await prisma.user.findMany({ select: { email: true, permissions: true, isActive: true } });
console.log('All users:', JSON.stringify(all, null, 2));
await prisma.$disconnect();
