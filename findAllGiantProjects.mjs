import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get ALL projects that might be "Giant"
  const projects = await prisma.project.findMany({
    where: {
      projectName: {
        contains: 'Giant'
      }
    },
    select: {
      id: true,
      projectName: true,
      customer: true,
      projectNumber: true,
      hours: true,
    }
  });
  
  console.log(`Found ${projects.length} projects with "Giant" in projectName\n`);
  
  projects.forEach((p) => {
    console.log(`${p.customer} - ${p.projectNumber}`);
    console.log(`  Project: ${p.projectName}`);
    console.log(`  Hours: ${p.hours}`);
  });
  
  // Check for schedules too
  const schedules = await prisma.schedule.findMany({
    where: {
      projectName: {
        contains: 'Giant'
      }
    },
    select: {
      jobKey: true,
      projectName: true,
      customer: true,
      totalHours: true,
    }
  });
  
  console.log(`\n\nFound ${schedules.length} schedules with "Giant" in projectName\n`);
  
  schedules.forEach((s) => {
    console.log(`${s.jobKey}`);
    console.log(`  Project: ${s.projectName}`);
    console.log(`  Customer: ${s.customer}`);
    console.log(`  Total Hours: ${s.totalHours}`);
  });
  
  // Now let's think about the 19x multiplier
  // The user said Jan 2026: 12,223 hours
  // Check how many projects match the customer
  
  const amesProjects = await prisma.project.findMany({
    where: {
      customer: 'Ames Construction, Inc.'
    },
    select: {
      projectName: true,
      projectNumber: true,
      hours: true
    }
  });
  
  console.log(`\n\nProjects for Ames Construction, Inc.:`);
  console.log(`Found ${amesProjects.length} projects\n`);
  
  amesProjects.forEach(p => {
    console.log(`  ${p.projectNumber}: ${p.projectName} (${p.hours}h)`);
  });
  
  // Check if there's a customer match issue
  const totalAamesHours = amesProjects.reduce((sum, p) => sum + (p.hours || 0), 0);
  console.log(`\nTotal hours for Ames Construction, Inc.: ${totalAamesHours}h`);
  
  // Check the 19x issue
  console.log('\n\n=== DEBUGGING 19x MULTIPLIER ===');
  console.log('If January shows 12,223 hours and project has 3,756 hours total...');
  console.log(`12,223 / 3,756 = ${(12223 / 3756).toFixed(1)}x`);
  console.log(`71,364 / 3,756 = ${(71364 / 3756).toFixed(1)}x`);
  
  // Check how many Ames projects exist
  console.log(`\nAmes has ${amesProjects.length} projects total`);
  console.log(`If showing all Ames projects combined for Giant, would get: ${totalAamesHours}h`);
  console.log(`${totalAamesHours} / 3756 = ${(totalAamesHours / 3756).toFixed(1)}x`);
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
