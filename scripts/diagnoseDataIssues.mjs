import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseData() {
  console.log('=== DATABASE INVENTORY ===\n');

  // 1. Check for projects with same identifying info
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      hours: true,
    },
    orderBy: { projectName: 'asc' }
  });

  const byCompositeKey = {};
  projects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    if (!byCompositeKey[key]) byCompositeKey[key] = [];
    byCompositeKey[key].push(p);
  });

  const projectDupes = Object.entries(byCompositeKey).filter(([_, items]) => items.length > 1);

  console.log(`Total projects: ${projects.length}`);
  console.log(`Projects with exact duplicate identifying info: ${projectDupes.length}`);
  
  if (projectDupes.length > 0) {
    console.log('\n⚠️  PROJECT DUPLICATES FOUND:');
    projectDupes.slice(0, 5).forEach(([key, items]) => {
      console.log(`\n  Key: ${key}`);
      items.forEach((p, i) => {
        console.log(`    [${i+1}] id=${p.id}, status=${p.status}, hours=${p.hours}`);
      });
    });
  }

  // 2. Check schedules and see if they match projects
  const schedules = await prisma.schedule.findMany({
    select: {
      id: true,
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      totalHours: true,
    },
  });

  console.log(`\n\nTotal schedules: ${schedules.length}`);

  // Find orphaned schedules (no matching project)
  let orphaned = 0;
  const orphanedSchedules = [];
  
  schedules.forEach(s => {
    const projectKey = `${s.customer || ''}~${s.projectNumber || ''}~${s.projectName || ''}`;
    const jobKey = s.jobKey || '';
    
    // Check if project exists and key matches
    const matching = projects.find(p => 
      p.customer === s.customer && 
      p.projectNumber === s.projectNumber && 
      p.projectName === s.projectName
    );
    
    if (!matching) {
      orphaned++;
      if (orphanedSchedules.length < 10) {
        orphanedSchedules.push({
          id: s.id,
          jobKey: s.jobKey,
          projectKey: projectKey,
        });
      }
    }
  });

  console.log(`Schedules with no matching project: ${orphaned}`);
  
  if (orphanedSchedules.length > 0) {
    console.log('\n⚠️  ORPHANED SCHEDULES (no matching project):');
    orphanedSchedules.forEach(s => {
      console.log(`  ${s.jobKey} (id=${s.id})`);
    });
  }

  // 3. Summarize by status
  console.log(`\n\nProjects by status:`);
  const byStatus = {};
  projects.forEach(p => {
    const status = p.status || 'Unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  });
  Object.entries(byStatus).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });

  await prisma.$disconnect();
  process.exit(0);
}

diagnoseData().catch(err => {
  console.error(err);
  process.exit(1);
});
