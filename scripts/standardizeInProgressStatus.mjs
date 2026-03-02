import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '..', '.env.local') });

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';
}

const prisma = new PrismaClient();

async function standardizeInProgressStatus() {
  try {
    console.log('Standardizing "in progress" to "In Progress"...\n');
    
    // Find all projects with lowercase "in progress"
    const lowercaseProjects = await prisma.project.findMany({
      where: {
        status: 'in progress'
      },
      select: {
        id: true,
        customer: true,
        projectNumber: true,
        projectName: true,
        status: true
      }
    });
    
    console.log(`Found ${lowercaseProjects.length} project(s) with lowercase "in progress":\n`);
    lowercaseProjects.forEach(p => {
      console.log(`  - ${p.customer} - ${p.projectNumber} - ${p.projectName}`);
    });
    
    if (lowercaseProjects.length === 0) {
      console.log('\n✅ No changes needed!');
      return;
    }
    
    // Update all to titlecase "In Progress"
    const updateResult = await prisma.project.updateMany({
      where: {
        status: 'in progress'
      },
      data: {
        status: 'In Progress'
      }
    });
    
    console.log(`\n✅ Updated ${updateResult.count} project(s) to "In Progress"`);
    
    // Also check and update Schedule table if needed
    const lowercaseSchedules = await prisma.schedule.findMany({
      where: {
        status: 'in progress'
      },
      select: {
        id: true,
        jobKey: true,
        status: true
      }
    });
    
    if (lowercaseSchedules.length > 0) {
      console.log(`\nFound ${lowercaseSchedules.length} schedule(s) with lowercase "in progress":`);
      lowercaseSchedules.forEach(s => {
        console.log(`  - ${s.jobKey}`);
      });
      
      const scheduleUpdateResult = await prisma.schedule.updateMany({
        where: {
          status: 'in progress'
        },
        data: {
          status: 'In Progress'
        }
      });
      
      console.log(`\n✅ Updated ${scheduleUpdateResult.count} schedule(s) to "In Progress"`);
    }
    
    console.log('\n✨ Status standardization complete!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

standardizeInProgressStatus();
