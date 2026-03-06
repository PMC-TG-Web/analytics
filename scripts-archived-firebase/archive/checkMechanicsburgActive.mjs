import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function check() {
  // Check ActiveSchedule for Mechanicsburg
  const active = await prisma.activeSchedule.findMany({
    where: {
      jobKey: {
        contains: 'mechanicsburg',
      },
    },
    select: {
      jobKey: true,
      scopeOfWork: true,
      date: true,
      hours: true,
      source: true,
    },
    orderBy: {
      date: 'asc',
    },
  });
  
  console.log('ActiveSchedule entries for Mechanicsburg:\n');
  if (active.length === 0) {
    console.log('❌ No entries found!\n');
  } else {
    active.forEach(a => {
      console.log(`Date: ${a.date} | ${a.hours.toFixed(1)}h | ${a.scopeOfWork} | Source: ${a.source}`);
      console.log(`JobKey: ${a.jobKey}\n`);
    });
  }
  
  await prisma.$disconnect();
}

check();
