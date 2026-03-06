import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function checkStatus() {
  try {
    const schedule = await prisma.schedule.findFirst({
      where: {
        projectName: {
          contains: 'Mechanicsburg'
        }
      }
    });
    
    console.log('\nSchedule entry:');
    console.log('  Customer:', schedule?.customer);
    console.log('  Status:', schedule?.status);
    console.log('  Total Hours:', schedule?.totalHours);
    
    const project = await prisma.project.findFirst({
      where: {
        projectName: {
          contains: 'Mechanicsburg'
        },
        customer: {
          contains: 'Centurion'
        }
      }
    });
    
    console.log('\nProject entry:');
    console.log('  Customer:', project?.customer);
    console.log('  Status:', project?.status);
    console.log('  Hours:', project?.hours);
    
    console.log('\n✅ CRITICAL: Scheduling page only shows status = "In Progress"');
    if (schedule && schedule.status !== 'In Progress') {
      console.log(`⚠️  PROBLEM: Schedule has status "${schedule.status}", not "In Progress"!`);
    } else if (schedule && schedule.status === 'In Progress') {
      console.log('✅ Schedule status is correct');
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

checkStatus();
