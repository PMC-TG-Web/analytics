import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugKeys() {
  // Get the schedule for Warfel/Tel Hai
  const schedules = await prisma.schedule.findMany({
    where: {
      customer: 'Warfel Construction',
      projectName: 'Tel Hai Health Center'
    }
  });

  console.log('Schedules found:', schedules.length);
  schedules.forEach(s => {
    console.log(`Schedule jobKey: "${s.jobKey}"`);
  });

  // Get the project to see what key format it creates
  const projects = await prisma.project.findMany({
    where: {
      customer: 'Warfel Construction',
      projectName: 'Tel Hai Health Center'
    }
  });

  console.log('\nProjects found:', projects.length);
  projects.forEach(p => {
    const key = `${p.customer ?? ''}~${p.projectNumber ?? ''}~${p.projectName ?? ''}`;
    console.log(`Project key: "${key}"`);
    console.log(`  customer: "${p.customer}"`);
    console.log(`  projectNumber: "${p.projectNumber}"`);
    console.log(`  projectName: "${p.projectName}"`);
  });

  // Check if they match
  if (schedules.length > 0 && projects.length > 0) {
    const scheduleKey = schedules[0].jobKey;
    const projectKey = `${projects[0].customer ?? ''}~${projects[0].projectNumber ?? ''}~${projects[0].projectName ?? ''}`;
    console.log(`\nKeys match: ${scheduleKey === projectKey}`);
    if (scheduleKey !== projectKey) {
      console.log(`  Schedule: "${scheduleKey}"`);
      console.log(`  Project:  "${projectKey}"`);
    }
  }

  await prisma.$disconnect();
  process.exit(0);
}

debugKeys().catch(err => {
  console.error(err);
  process.exit(1);
});
