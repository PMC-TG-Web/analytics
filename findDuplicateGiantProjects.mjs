import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Check the projects table for how many Giant #6582 entries exist with jobKey matching
  const allProjects = await prisma.project.findMany({
    where: {
      status: { in: ['In Progress', 'Accepted', 'Complete'] }
    },
    select: {
      projectName: true,
      projectNumber: true,
      customer: true,
      hours: true,
    }
  });
  
  // Build the key the same way the frontend does
  const projectsByKey = new Map();
  
  allProjects.forEach(p => {
    const key = `${p.customer ?? ""}~${p.projectNumber ?? ""}~${p.projectName ?? ""}`;
    if (!projectsByKey.has(key)) {
      projectsByKey.set(key, []);
    }
    projectsByKey.get(key).push(p);
  });
  
  // Find the Giant #6582 key and check for duplicates
  const giantKey = 'Ames Construction, Inc.~2508 - GI~Giant #6582';
  const giantProjects = projectsByKey.get(giantKey) || [];
  
  console.log(`Projects matching Giant #6582 key: "${giantKey}"\n`);
  console.log(`Found ${giantProjects.length} projects:\n`);
  
  let totalHours = 0;
  giantProjects.forEach((p, idx) => {
    console.log(`[${idx + 1}] ${p.projectName}`);
    console.log(`    Customer: ${p.customer}`);
    console.log(`    Project #: ${p.projectNumber}`);
    console.log(`    Hours: ${p.hours}`);
    console.log('');
    totalHours += p.hours || 0;
  });
  
  console.log(`\nTotal hours (sum of all duplicates): ${totalHours}`);
  
  // Check if this matches the user's observation
  console.log(`\n=== VERIFICATION ===`);
  console.log(`If frontend shows "Giant #6582" with ${totalHours}h total...`);
  console.log(`And January allocation is 25%...`);
  console.log(`Then January display would be: ${totalHours} * 0.25 = ${totalHours * 0.25}`);
  
  if (giantProjects.length > 1) {
    console.log(`\n!!! BUG FOUND !!!`);
    console.log(`${giantProjects.length} duplicate project records are being SUMMED for this job.`);
    console.log(`This is causing the inflated hours!`);
  }
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
