import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: '.env.local' });

const prisma = new PrismaClient();

async function check() {
  try {
    console.log('\n=== CHECKING JONAS KING PROJECT ===\n');

    // Find Jonas King project
    const jonasProjects = await prisma.activeSchedule.findMany({
      where: {
        OR: [
          { jobKey: { contains: 'Jonas' } },
          { jobKey: { contains: 'King' } },
          { scopeOfWork: { contains: 'King Sidewalk' } },
        ]
      },
      select: {
        id: true,
        jobKey: true,
        scopeOfWork: true,
        date: true,
        hours: true,
        foreman: true,
        source: true,
      },
      orderBy: { date: 'asc' }
    });

    console.log(`Found ${jonasProjects.length} Jonas King entries in ActiveSchedule:`);
    jonasProjects.forEach(p => {
      console.log(`  - ${p.date} | ${p.foreman || 'UNASSIGNED'} | ${p.scopeOfWork} | ${p.hours}h | source: ${p.source}`);
    });

    if (jonasProjects.length === 0) {
      console.log('  (No entries found)');
    }

    // Check for any entries today (March 5, 2026)
    console.log('\n--- Entries for March 5, 2026 ---');
    const march5Entries = await prisma.activeSchedule.findMany({
      where: {
        date: '2026-03-05',
      },
      select: {
        jobKey: true,
        scopeOfWork: true,
        hours: true,
        foreman: true,
        source: true,
      },
      orderBy: { jobKey: 'asc' }
    });
    console.log(`Total entries for 2026-03-05: ${march5Entries.length}`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

check();
