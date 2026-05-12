import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const email = 'isaac@pmcdecor.com';
const permissions = ['ESTIMATOR'];

const result = await prisma.user.upsert({
  where: { email },
  update: { permissions, isActive: true },
  create: { email, permissions, isActive: true },
});

console.log('Upserted:', JSON.stringify(result, null, 2));
await prisma.$disconnect();
