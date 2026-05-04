import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const users = [
  { email: 'mervin@pmcdecor.com', permissions: ['PMs'] },
  { email: 'abner@pmcdecor.com', permissions: ['PMs'] },
  { email: 'jason@pmcdecor.com', permissions: ['PMs'] },
  { email: 'john@pmcdecor.com', permissions: ['ADMIN'] },
];

for (const { email, permissions } of users) {
  const result = await prisma.user.upsert({
    where: { email },
    update: { permissions, isActive: true },
    create: { email, permissions, isActive: true },
  });
  console.log('Upserted:', JSON.stringify(result, null, 2));
}

const all = await prisma.user.findMany({ select: { email: true, permissions: true, isActive: true } });
console.log('All users:', JSON.stringify(all, null, 2));
await prisma.$disconnect();
