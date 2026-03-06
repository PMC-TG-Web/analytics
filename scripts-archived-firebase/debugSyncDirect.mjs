import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function debug() {
  try {
    const projectId = '9cde4d43a1f9a5ae2b50a4a8';
    
    // Get the project
    const project = await prisma.$queryRawUnsafe(`
      SELECT id, project_name, project_number, customer
      FROM gantt_v2_projects
      WHERE id = $1
    `, projectId);
    
    console.log('=== PROJECT ===');
    console.log(project[0]);
    
    const projectData = project[0];
    
    // Get all activeSchedule entries
    const allActiveSchedule = await prisma.activeSchedule.findMany({
      select: { jobKey: true },
      distinct: ['jobKey'],
    });
    
    console.log('\n=== ALL JOB KEYS IN ACTIVE SCHEDULE ===');
    console.log('Total unique jobKeys:', allActiveSchedule.length);
    console.log('JobKeys:', allActiveSchedule.map(e => e.jobKey));
    
    // Try to find Westminster by project number
    console.log('\n=== SEARCHING FOR PROJECT NUMBER:', projectData.project_number, '===');
    const byProjectNumber = await prisma.activeSchedule.findMany({
      where: {
        jobKey: {
          contains: projectData.project_number,
        },
      },
      select: { jobKey: true, hours: true, scopeOfWork: true, date: true },
    });
    
    console.log('Found:', byProjectNumber.length, 'entries');
    if (byProjectNumber.length > 0) {
      console.log('Entries:');
      byProjectNumber.forEach(entry => {
        console.log(`  - JobKey: ${entry.jobKey}`);
        console.log(`    Scope: ${entry.scopeOfWork}`);
        console.log(`    Date: ${entry.date}`);
        console.log(`    Hours: ${entry.hours}`);
      });
    }
    
    // Try to find Westminster by project name
    console.log('\n=== SEARCHING FOR PROJECT NAME:', projectData.project_name.substring(0, 15), '===');
    const byProjectName = await prisma.activeSchedule.findMany({
      where: {
        jobKey: {
          contains: projectData.project_name.substring(0, 15),
        },
      },
      select: { jobKey: true, hours: true, scopeOfWork: true, date: true },
    });
    
    console.log('Found:', byProjectName.length, 'entries');
    if (byProjectName.length > 0) {
      console.log('Entries:');
      byProjectName.forEach(entry => {
        console.log(`  - JobKey: ${entry.jobKey}`);
        console.log(`    Scope: ${entry.scopeOfWork}`);
        console.log(`    Date: ${entry.date}`);
        console.log(`    Hours: ${entry.hours}`);
      });
    }
    
    // Check case-insensitive search
    console.log('\n=== TRY CASE-INSENSITIVE SEARCH ===');
    const caseInsensitive = await prisma.$queryRaw`
      SELECT "jobKey", "scopeOfWork", "date", hours
      FROM "ActiveSchedule"
      WHERE "jobKey" ILIKE ${`%${projectData.project_number}%`}
      LIMIT 10
    `;
    
    console.log('Found:', caseInsensitive.length, 'entries (case-insensitive)');
    if (caseInsensitive.length > 0) {
      console.log('Entries:');
      caseInsensitive.forEach(entry => {
        console.log(`  - JobKey: ${entry.jobKey}`);
        console.log(`    Scope: ${entry.scopeOfWork}`);
        console.log(`    Hours: ${entry.hours}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

debug();
