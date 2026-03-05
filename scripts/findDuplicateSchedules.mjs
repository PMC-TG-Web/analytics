import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findDuplicateSchedules() {
  const allSchedules = await prisma.schedule.findMany({
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectName: true,
      totalHours: true,
      createdAt: true,
    },
  });

  console.log('Total schedules:', allSchedules.length);

  // Group by normalized key (case-insensitive, no spaces)
  const normalized = {};
  allSchedules.forEach(s => {
    const normKey = (s.jobKey || '').toLowerCase().replace(/[\s\-]/g, '');
    if (!normalized[normKey]) {
      normalized[normKey] = [];
    }
    normalized[normKey].push(s);
  });

  const duplicates = Object.entries(normalized).filter(([_, items]) => items.length > 1);

  console.log(`\nDuplicate jobKeys found (normalized): ${duplicates.length}`);

  if (duplicates.length > 0) {
    console.log('\nDuplicate Schedules:');
    duplicates.forEach(([normKey, items]) => {
      console.log(`\nNormalized key: ${normKey}`);
      items.forEach((s, i) => {
        console.log(`  [${i+1}] id=${s.id}, jobKey="${s.jobKey}", created=${s.createdAt}`);
      });
    });

    console.log(`\nTo fix: Delete the older (earlier createdAt) schedule for each duplicate`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

findDuplicateSchedules().catch(err => {
  console.error(err);
  process.exit(1);
});
