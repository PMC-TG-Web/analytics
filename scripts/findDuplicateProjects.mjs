import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function findDuplicates() {
  // Check Project model
  const projects = await prisma.project.findMany();
  console.log('=== PROJECT MODEL ===');
  console.log('Total projects:', projects.length);
  
  const byProjectKey = {};
  projects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName}`;
    if (!byProjectKey[key]) byProjectKey[key] = [];
    byProjectKey[key].push(p);
  });
  
  const projectDupes = Object.entries(byProjectKey).filter(([_, items]) => items.length > 1);
  console.log('Duplicate Project entries:', projectDupes.length);
  
  // Check Schedule model
  const schedules = await prisma.schedule.findMany();
  console.log('\n=== SCHEDULE MODEL ===');
  console.log('Total schedules:', schedules.length);
  
  const byJobKey = {};
  schedules.forEach(s => {
    if (!byJobKey[s.jobKey]) byJobKey[s.jobKey] = [];
    byJobKey[s.jobKey].push(s);
  });
  
  const scheduleDupes = Object.entries(byJobKey).filter(([_, items]) => items.length > 1);
  console.log('Duplicate jobKeys in Schedule:', scheduleDupes.length);
  
  if (scheduleDupes.length > 0) {
    console.log('\nDuplicate Schedules:');
    scheduleDupes.forEach(([jobKey, items]) => {
      console.log(`\njobKey: ${jobKey}`);
      items.forEach((s, i) => {
        console.log(`  [${i+1}] id=${s.id}, hours=${s.totalHours}, created=${s.createdAt}`);
      });
    });
  }
  
  // Check ProjectScope model
  const scopes = await prisma.projectScope.findMany();
  console.log('\n=== PROJECT SCOPE MODEL ===');
  console.log('Total scopes:', scopes.length);
  
  const byJobKeyScope = {};
  scopes.forEach(s => {
    if (!byJobKeyScope[s.jobKey]) byJobKeyScope[s.jobKey] = [];
    byJobKeyScope[s.jobKey].push(s);
  });
  
  const scopeDupes = Object.entries(byJobKeyScope).filter(([_, items]) => items.length > 1);
  console.log('JobKeys with multiple scopes:', scopeDupes.length);
  if (scopeDupes.length > 0) {
    console.log('(This is normal - projects typically have multiple scopes)');
    console.log(`Example: ${Object.entries(byJobKeyScope)[0][0]} has ${Object.entries(byJobKeyScope)[0][1].length} scopes`);
  }
  
  await prisma.$disconnect();
  process.exit(0);
}

findDuplicates().catch(err => {
  console.error(err);
  process.exit(1);
});
