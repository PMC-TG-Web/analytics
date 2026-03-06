import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const prisma = new PrismaClient();

async function fix() {
  try {
    console.log('\n=== RESTORING JONAS KING ===\n');

    // Update to 'gantt' source so it shows in short-term schedule
    const result = await prisma.$executeRaw`
      UPDATE "ActiveSchedule"
      SET source = 'gantt'
      WHERE "scopeOfWork" LIKE '%Walk%'
    `;

    console.log(`Updated ${result} entries to source: gantt`);

    const entries = await prisma.activeSchedule.findMany({
      where: {
        scopeOfWork: { contains: 'Walk' },
      },
      select: {
        date: true,
        scopeOfWork: true,
        source: true,
      },
    });

    console.log('\nCurrent Walk entries:');
    entries.forEach(e => {
      console.log(`  ${e.date} | ${e.scopeOfWork} | source: ${e.source}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fix();
