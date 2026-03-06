// Check if loaded schedules have matching projects

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Get a few loaded schedules
  const schedules = await prisma.schedule.findMany({
    take: 10,
    select: {
      jobKey: true,
    },
  });

  console.log(`\n📋 Found ${schedules.length} schedules\n`);

  // Get all projects
  const projects = await prisma.project.findMany({
    select: {
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
    },
  });

  console.log(`💾 Found ${projects.length} projects in database\n`);

  // Build jobKey lookup
  const projectsByJobKey = new Map();
  projects.forEach((p) => {
    const jobKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    projectsByJobKey.set(jobKey, p);
  });

  console.log('Checking schedule matches:\n');
  schedules.forEach((s) => {
    const project = projectsByJobKey.get(s.jobKey);
    if (project) {
      console.log(`✓ ${s.jobKey}`);
      console.log(`  Status: ${project.status}`);
    } else {
      console.log(`✗ ${s.jobKey}`);
      console.log(`  No matching project found`);
    }
    console.log('');
  });

  await prisma.$disconnect();
}

check().catch(console.error);
