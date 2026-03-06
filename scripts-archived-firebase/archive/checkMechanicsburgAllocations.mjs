import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function checkAllocations() {
  try {
    const schedule = await prisma.schedule.findFirst({
      where: {
        projectName: {
          contains: 'Mechanicsburg'
        }
      }
    });
    
    console.log('\n📊 Mechanicsburg Schedule Entry:');
    console.log('Customer:', schedule?.customer);
    console.log('Project Name:', schedule?.projectName);
    console.log('Total Hours:', schedule?.totalHours);
    console.log('\n📅 Allocations Object:');
    console.log(JSON.stringify(schedule?.allocations, null, 2));
    console.log('\nAllocations Type:', typeof schedule?.allocations);
    console.log('Is null?', schedule?.allocations === null);
    console.log('Is empty object?', schedule?.allocations && Object.keys(schedule.allocations).length === 0);
    
    if (schedule?.allocations && typeof schedule.allocations === 'object') {
      console.log('\n📊 Allocation Details:');
      for (const [month, value] of Object.entries(schedule.allocations)) {
        console.log(`  ${month}: ${value}% (${schedule.totalHours * (value / 100)} hours)`);
      }
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

checkAllocations();
