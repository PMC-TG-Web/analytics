// Verify allocations for the 4 updated projects

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function verifyAllocations() {
  console.log('\n========================================');
  console.log('VERIFYING ALLOCATIONS FOR UPDATED PROJECTS');
  console.log('========================================\n');

  const projectNames = [
    'Alderfer Eggs Curb',
    'Alexander Drive Addition',
    'Ducklings Ambassador Circle',
    'Paneling Sales Pine Building'
  ];

  for (const name of projectNames) {
    const schedules = await prisma.schedule.findMany({
      where: { projectName: name },
      select: {
        jobKey: true,
        projectName: true,
        status: true,
        totalHours: true,
        allocations: true,
      }
    });

    if (schedules.length === 0) {
      console.log(`❌ No schedule found for: ${name}\n`);
      continue;
    }

    schedules.forEach(schedule => {
      console.log(`✅ ${schedule.projectName}`);
      console.log(`   JobKey: ${schedule.jobKey}`);
      console.log(`   Status: ${schedule.status}`);
      console.log(`   Total Hours: ${schedule.totalHours}`);
      
      // Parse allocations
      let allocations = [];
      if (Array.isArray(schedule.allocations)) {
        allocations = schedule.allocations;
      } else if (typeof schedule.allocations === 'object' && schedule.allocations !== null) {
        allocations = Object.entries(schedule.allocations).map(([month, percent]) => ({
          month,
          percent
        }));
      }

      if (allocations.length > 0) {
        console.log(`   Allocations:`);
        allocations.forEach(a => {
          const hours = schedule.totalHours * (a.percent / 100);
          console.log(`      ${a.month}: ${a.percent}% (${hours.toFixed(1)} hours)`);
        });
      } else {
        console.log(`   ⚠️  No allocations found!`);
      }
      console.log('');
    });
  }

  await prisma.$disconnect();
}

verifyAllocations().catch(console.error);
