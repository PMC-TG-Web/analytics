// Check database connection and projects

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function check() {
  console.log('\n========================================');
  console.log('DATABASE CONNECTION CHECK');
  console.log('========================================\n');

  try {
    // Check projects
    const projectCount = await prisma.project.count();
    console.log(`📊 Total projects in database: ${projectCount}\n`);

    if (projectCount > 0) {
      const sampleProjects = await prisma.project.findMany({
        take: 5,
        select: {
          id: true,
          customer: true,
          projectNumber: true,
          projectName: true,
          status: true,
          hours: true,
        },
      });

      console.log('Sample projects:');
      sampleProjects.forEach((p, idx) => {
        console.log(`\n${idx + 1}. ${p.customer} | ${p.projectNumber} | ${p.projectName}`);
        console.log(`   Status: ${p.status}, Hours: ${p.hours}`);
      });
    }

    // Check schedules
    const scheduleCount = await prisma.schedule.count();
    console.log(`\n\n📅 Total schedules in database: ${scheduleCount}\n`);

    if (scheduleCount > 0) {
      const sampleSchedules = await prisma.schedule.findMany({
        take: 5,
        select: {
          jobKey: true,
          customer: true,
          projectName: true,
          status: true,
          totalHours: true,
        },
      });

      console.log('Sample schedules:');
      sampleSchedules.forEach((s, idx) => {
        console.log(`\n${idx + 1}. ${s.jobKey}`);
        console.log(`   Customer: ${s.customer}`);
        console.log(`   Status: ${s.status}, Hours: ${s.totalHours}`);
      });
    }

    // Check for a specific project from loaded schedules
    console.log('\n\n========================================');
    console.log('CHECKING FOR MATCHED PROJECTS');
    console.log('========================================\n');

    const testSchedule = await prisma.schedule.findFirst({
      where: { status: 'In Progress' },
      select: {
        jobKey: true,
        customer: true,
        projectNumber: true,
        projectName: true,
      },
    });

    if (testSchedule) {
      console.log(`Looking for project matching schedule:`);
      console.log(`  Customer: "${testSchedule.customer}"`);
      console.log(`  Project Number: "${testSchedule.projectNumber}"`);
      console.log(`  Project Name: "${testSchedule.projectName}"`);

      const matchingProject = await prisma.project.findFirst({
        where: {
          customer: testSchedule.customer,
          projectNumber: testSchedule.projectNumber,
          projectName: testSchedule.projectName,
        },
      });

      if (matchingProject) {
        console.log(`\n✅ FOUND matching project!`);
        console.log(`   Status: ${matchingProject.status}`);
      } else {
        console.log(`\n❌ NO matching project found`);
        
        // Try partial match
        const partialMatch = await prisma.project.findFirst({
          where: {
            projectName: testSchedule.projectName,
          },
        });
        
        if (partialMatch) {
          console.log(`\n⚠️  Found project with SAME NAME but different fields:`);
          console.log(`   Customer: "${partialMatch.customer}" (expected: "${testSchedule.customer}")`);
          console.log(`   Project Number: "${partialMatch.projectNumber}" (expected: "${testSchedule.projectNumber}")`);
        }
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
