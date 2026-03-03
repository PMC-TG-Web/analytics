import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function check() {
  const total = await prisma.activeSchedule.count();
  console.log(`Total ActiveSchedule entries: ${total}`);
  
  const recent = await prisma.activeSchedule.findMany({
    orderBy: { lastModified: 'desc' },
    take: 10,
    select: {
      jobKey: true,
      scopeOfWork: true,
      date: true,
      hours: true,
      lastModified: true,
    },
  });
  
  console.log('\nMost recent 10 entries:');
  recent.forEach((entry) => {
    const projectName = entry.jobKey.split('~')[2] || 'Unknown';
    console.log(`${entry.date} | ${projectName.substring(0, 30).padEnd(30)} | ${entry.hours.toFixed(1)}h | ${entry.scopeOfWork.substring(0, 25)}`);
  });
  
  await prisma.$disconnect();
}

check();
