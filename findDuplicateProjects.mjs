import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get all projects that are "In Progress"
  const projects = await prisma.project.findMany({
    where: {
      status: 'In Progress'
    },
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      hours: true,
    },
    orderBy: [
      { customer: 'asc' },
      { projectNumber: 'asc' },
      { projectName: 'asc' }
    ]
  });
  
  // Group by jobKey (same as frontend does)
  const jobKeyMap = new Map();
  
  projects.forEach(p => {
    const jobKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    if (!jobKeyMap.has(jobKey)) {
      jobKeyMap.set(jobKey, []);
    }
    jobKeyMap.get(jobKey).push(p);
  });
  
  // Find jobs with multiple project records
  console.log('Jobs with MULTIPLE Project records (duplicates):\n');
  
  let duplicateCount = 0;
  jobKeyMap.forEach((projectList, jobKey) => {
    if (projectList.length > 1) {
      duplicateCount++;
      console.log(`\n[${duplicateCount}] ${jobKey}`);
      console.log(`  ${projectList.length} project records:`);
      
      let totalHours = 0;
      projectList.forEach((p, idx) => {
        console.log(`    [${idx + 1}] ID: ${p.id}`);
        console.log(`        Hours: ${p.hours}`);
        totalHours += p.hours || 0;
      });
      
      console.log(`  Combined hours: ${totalHours}`);
      console.log(`  Multiplier: ${(totalHours / (projectList[0].hours || 1)).toFixed(1)}x`);
    }
  });
  
  if (duplicateCount === 0) {
    console.log('  None found - all jobs have exactly one Project record\n');
  } else {
    console.log(`\n\nFound ${duplicateCount} jobs with duplicate Project records`);
    console.log('These could be causing the inflated hours if Gantt scopes are matching multiple cost items!\n');
  }
  
  // Specifically check Giant #6582
  console.log('\n\n=== GIANT #6582 SPECIFIC CHECK ===\n');
  const giantKey = 'Ames Construction, Inc.~2508 - GI~Giant #6582';
  const giantProjects = jobKeyMap.get(giantKey) || [];
  
  console.log(`Giant #6582 has ${giantProjects.length} Project record(s)`);
  if (giantProjects.length > 1) {
    console.log('\n⚠️  MULTIPLE RECORDS FOUND - This is the bug!\n');
    giantProjects.forEach((p, idx) => {
      console.log(`  [${idx + 1}] ID: ${p.id} - ${p.hours} hours`);
    });
  }
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
