import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const count = await prisma.activeSchedule.count({ where: { source: 'gantt' } });
console.log('Total GANTT entries in activeSchedule:', count);

if (count > 0) {
  const sample = await prisma.activeSchedule.findFirst({ where: { source: 'gantt' } });
  console.log('Sample entry:', sample);
}

process.exit(0);
