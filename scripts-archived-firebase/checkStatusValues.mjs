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

async function checkStatusValues() {
  try {
    // Get all unique status values
    const projects = await prisma.project.findMany({
      where: {
        projectArchived: false,
        status: {
          not: null
        }
      },
      select: {
        status: true,
        customer: true,
        projectNumber: true,
        projectName: true
      }
    });

    // Group by status
    const statusGroups = {};
    projects.forEach(p => {
      const status = p.status || 'Unknown';
      if (!statusGroups[status]) {
        statusGroups[status] = [];
      }
      statusGroups[status].push(`${p.customer} - ${p.projectNumber} - ${p.projectName}`);
    });

    console.log('\n=== All Status Values in Database ===\n');
    Object.keys(statusGroups).sort().forEach(status => {
      console.log(`\n${status} (${statusGroups[status].length} projects)`);
      
      // Show first 3 examples for each status
      statusGroups[status].slice(0, 3).forEach(project => {
        console.log(`  - ${project}`);
      });
      
      if (statusGroups[status].length > 3) {
        console.log(`  ... and ${statusGroups[status].length - 3} more`);
      }
    });

    // Check specifically for "In Process" vs "In Progress"
    console.log('\n=== Checking for "In Process" vs "In Progress" ===\n');
    const inProcess = statusGroups['In Process'] || [];
    const inProgress = statusGroups['In Progress'] || [];
    
    console.log(`"In Process": ${inProcess.length} projects`);
    inProcess.forEach(p => console.log(`  - ${p}`));
    
    console.log(`\n"In Progress": ${inProgress.length} projects`);
    inProgress.forEach(p => console.log(`  - ${p}`));

    if (inProcess.length > 0 && inProgress.length > 0) {
      console.log('\n⚠️  WARNING: Both "In Process" and "In Progress" status values exist!');
      console.log('This would create duplicate cards on the dashboard.');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkStatusValues();
