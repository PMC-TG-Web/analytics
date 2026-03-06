import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();

async function checkForDuplicates() {
  // Get basic project stats
  const allProjects = await prisma.project.findMany({
    select: {
      id: true,
      projectNumber: true,
      projectName: true,
      customer: true,
      status: true,
      hours: true,
      projectArchived: true,
    },
  });

  console.log('Total projects in database:', allProjects.length);

  // Group by composite key to find exact duplicates
  const byKey = {};
  allProjects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(p);
  });

  const duplicateKeysCount = Object.entries(byKey).filter(([_, items]) => items.length > 1).length;
  console.log('Composite keys with multiple entries:', duplicateKeysCount);

  if (duplicateKeysCount > 0) {
    console.log('\nDuplicate entries:');
    Object.entries(byKey).forEach(([key, items]) => {
      if (items.length > 1) {
        console.log(`\n  Key: ${key}`);
        items.forEach((p, i) => {
          console.log(`    [${i+1}] id=${p.id}, status=${p.status}, hours=${p.hours}, archived=${p.projectArchived}`);
        });
      }
    });
  }

  // Check what the scheduling page would see (In Progress status only)
  const inProgressProjects = allProjects.filter(p => p.status === 'In Progress');
  console.log(`\nProjects with 'In Progress' status: ${inProgressProjects.length}`);

  // Count duplicates among In Progress
  const inProgByKey = {};
  inProgressProjects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    if (!inProgByKey[key]) inProgByKey[key] = [];
    inProgByKey[key].push(p);
  });

  const inProgDuplicates = Object.entries(inProgByKey).filter(([_, items]) => items.length > 1);
  console.log(`In Progress projects with duplicate keys: ${inProgDuplicates.length}`);

  if (inProgDuplicates.length > 0) {
    console.log('\n⚠️  Duplicate In Progress projects:');
    inProgDuplicates.forEach(([key, items]) => {
      console.log(`\n  Key: ${key}`);
      items.forEach((p, i) => {
        console.log(`    [${i+1}] id=${p.id}, hours=${p.hours}`);
      });
    });
  }

  await prisma.$disconnect();
  process.exit(0);
}

checkForDuplicates().catch(err => {
  console.error(err);
  process.exit(1);
});
