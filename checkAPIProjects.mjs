import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Simulate what the /api/projects endpoint returns
  const projects = await prisma.project.findMany({
    where: {
      status: { notIn: ['Bid Submitted', 'Lost'] }
    },
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      hours: true,
      status: true,
    }
  });
  
  console.log(`Total projects returned by API: ${projects.length}\n`);
  
  // Build jobKey map
  const jobKeyMap = new Map();
  
  projects.forEach(p => {
    const jobKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    if (!jobKeyMap.has(jobKey)) {
      jobKeyMap.set(jobKey, []);
    }
    jobKeyMap.get(jobKey).push(p);
  });
  
  // Find jobs where the API returns multiple Project records with same jobKey
  const duplicates = [];
  jobKeyMap.forEach((projectList, jobKey) => {
    if (projectList.length > 1) {
      duplicates.push({ jobKey, count: projectList.length, projects: projectList });
    }
  });
  
  if (duplicates.length === 0) {
    console.log('No duplicate jobKeys found in API response\n');
  } else {
    console.log(`Found ${duplicates.length} jobKeys with multiple Project records:\n`);
    
    duplicates.slice(0, 10).forEach(dup => {
      console.log(`${dup.jobKey}`);
      console.log(`  ${dup.count} records:`);
      dup.projects.forEach((p, idx) => {
        console.log(`    [${idx + 1}] ID: ${p.id}, Hours: ${p.hours}, Status: ${p.status}`);
      });
      
      const totalHours = dup.projects.reduce((sum, p) => sum + (p.hours || 0), 0);
      const firstHours = dup.projects[0].hours || 0;
      console.log(`  Sum of hours: ${totalHours} (${(totalHours / firstHours).toFixed(1)}x first record)`);
      console.log('');
    });
    
    if (duplicates.length > 10) {
      console.log(`... and ${duplicates.length - 10} more\n`);
    }
  }
  
  // Check specific jobs from screenshot
  const jobsToCheck = [
    'Heck Construction~2512 - GFS~Gish Furniture Sitework',
    'Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment',
    'Hoover Building Specialists, Inc.~2511-SFM~Sauders Feedmill'
  ];
  
  console.log('\n\n=== CHECKING SPECIFIC JOBS FROM SCREENSHOT ===\n');
  
  jobsToCheck.forEach(jobKey => {
    const records = jobKeyMap.get(jobKey) || [];
    console.log(`${jobKey}:`);
    console.log(`  ${records.length} record(s) in API response`);
    if (records.length > 1) {
      console.log(`  ⚠️  DUPLICATE! This would cause ${records.length}x inflation in Gantt hours`);
    }
  });
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});
