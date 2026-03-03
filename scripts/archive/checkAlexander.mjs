// Check what Alexander schedules remain

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

const schedules = await prisma.schedule.findMany({
  where: {
    projectName: {
      contains: 'Alexander'
    }
  },
  select: {
    jobKey: true,
    customer: true,
    projectName: true,
    status: true,
    totalHours: true,
    allocations: true
  }
});

console.log(`\nAlexander schedules remaining: ${schedules.length}\n`);
schedules.forEach(s => {
  console.log(`  ${s.customer || '(blank)'} - ${s.projectName} - ${s.totalHours} hrs`);
  console.log(`  JobKey: ${s.jobKey}`);
  console.log(`  Allocations:`, s.allocations);
  console.log('');
});

await prisma.$disconnect();
