import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function check() {
  // Find schedules with allocations (not empty object)
  const schedules = await prisma.schedule.findMany({
    select: {
      projectName: true,
      customer: true,
      allocations: true,
    },
  });
  
  const withAllocations = schedules.filter(s => {
    const allocs = s.allocations || {};
    return Object.keys(allocs).length > 0;
  });
  
  console.log(`Total schedules: ${schedules.length}`);
  console.log(`Schedules with allocations: ${withAllocations.length}\n`);
  
  console.log('Sample schedules with allocations:\n');
  withAllocations.slice(0, 10).forEach((s, idx) => {
    console.log(`${idx + 1}. ${s.customer || '(no customer)'} / ${s.projectName}`);
    const allocs = s.allocations || {};
    const entries = Object.entries(allocs);
    entries.slice(0, 5).forEach(([month, pct]) => {
      console.log(`   ${month}: ${pct}%`);
    });
    if (entries.length > 5) {
      console.log(`   ... and ${entries.length - 5} more months`);
    }
    console.log('');
  });
  
  await prisma.$disconnect();
}

check();
