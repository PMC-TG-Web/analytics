// Update Schedule table status for the 4 updated projects

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function updateSchedules() {
  console.log('\n========================================');
  console.log('UPDATING SCHEDULE TABLE STATUS');
  console.log('========================================\n');

  const projectNames = [
    'Alderfer Eggs Curb',
    'Alexander Drive Addition',
    'Ducklings Ambassador Circle',
    'Paneling Sales Pine Building'
  ];

  let totalUpdated = 0;

  for (const name of projectNames) {
    const result = await prisma.schedule.updateMany({
      where: { projectName: name },
      data: { status: 'In Progress' }
    });
    
    if (result.count > 0) {
      console.log(`✅ Updated ${result.count} schedule(s) for: ${name}`);
      totalUpdated += result.count;
    } else {
      console.log(`⚠️  No schedules found for: ${name}`);
    }
  }

  console.log(`\n📊 Total schedules updated: ${totalUpdated}`);

  await prisma.$disconnect();
}

updateSchedules().catch(console.error);
