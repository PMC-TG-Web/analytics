import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkOrphans() {
  const orphanIds = [
    'cmm9klybv003fe3osurjnvapi',
    'cmm9klyge003je3os1m3zjlvu',
    'cmm9klynk003qe3osk2g4o4ni',
    'cmmakdwk8000fe3fgc0adh276',
    'cmmaq2tw20000e3lsntfwfrbx',
    'cmmaqpy6l006pe3u0pukc1bge',
    'cmmaqpy9c006te3u05lz6kkh7',
    'cmmaq2xer0007e3lsrtu7seim',
  ];

  const orphans = await prisma.schedule.findMany({
    where: {
      id: { in: orphanIds }
    },
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      totalHours: true,
      status: true,
      createdAt: true,
      allocationsList: {
        select: { period: true, percent: true },
        take: 3,
      }
    }
  });

  console.log('Orphaned Schedules Details:\n');
  orphans.forEach((s, i) => {
    console.log(`[${i+1}] Customer: ${s.customer}`);
    console.log(`    Project: ${s.projectName}`);
    console.log(`    jobKey: ${s.jobKey}`);
    console.log(`    Status: ${s.status}, Hours: ${s.totalHours}, Created: ${s.createdAt}`);
    console.log(`    Allocations: ${s.allocationsList.length > 0 ? s.allocationsList.map(a => `${a.period}:${a.percent}%`).join(', ') : 'None'}`);
    console.log('');
  });

  console.log('\nThese schedules have no matching project. Options:');
  console.log('1. Delete them (if they are truly orphaned/stale)');
  console.log('2. Create corresponding projects');
  console.log('3. Check if projects exist with different customer/number formatting');

  await prisma.$disconnect();
  process.exit(0);
}

checkOrphans().catch(err => {
  console.error(err);
  process.exit(1);
});
