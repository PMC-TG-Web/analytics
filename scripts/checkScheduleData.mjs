import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyze() {
  console.log('\n=== Checking Why Data Appears on Long-Term Schedule ===\n');
  
  // Check ProjectScope entries
  const scopes = await prisma.projectScope.findMany({
    select: {
      jobKey: true,
      title: true
    }
  });
  
  console.log(`ProjectScope entries: ${scopes.length}`);
  if (scopes.length > 0) {
    console.log('Scopes found:');
    scopes.slice(0, 10).forEach(s => {
      console.log(`  - ${s.jobKey}: ${s.title}`);
    });
  }
  
  // Check ActiveSchedule entries with source='schedules'
  const activeSchedules = await prisma.activeSchedule.findMany({
    where: {
      source: 'schedules'
    },
    select: {
      jobKey: true,
      date: true,
      hours: true
    }
  });
  
  console.log(`\nActiveSchedule records (source='schedules'): ${activeSchedules.length}`);
  
  // Group by jobKey to see which projects have data
  const byJobKey = {};
  activeSchedules.forEach(a => {
    if (!byJobKey[a.jobKey]) {
      byJobKey[a.jobKey] = 0;
    }
    byJobKey[a.jobKey] += a.hours;
  });
  
  console.log('\nProjects with scheduled hours:');
  Object.entries(byJobKey)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([jobKey, hours]) => {
      console.log(`  - ${jobKey}: ${Math.round(hours)} hours`);
    });
  
  // Check which of these projects have scopes
  const jobKeysWithScopes = new Set(scopes.map(s => s.jobKey));
  const jobKeysWithSchedules = Object.keys(byJobKey);
  
  console.log('\n=== Analysis ===');
  console.log(`Projects with scopes: ${jobKeysWithScopes.size}`);
  console.log(`Projects with schedules: ${jobKeysWithSchedules.length}`);
  console.log(`Projects with schedules but NO scopes: ${jobKeysWithSchedules.filter(jk => !jobKeysWithScopes.has(jk)).length}`);
  
  const scheduledButNoScopes = jobKeysWithSchedules.filter(jk => !jobKeysWithScopes.has(jk));
  if (scheduledButNoScopes.length > 0) {
    console.log('\nThese projects should NOT appear on long-term schedule (no scopes):');
    scheduledButNoScopes.slice(0, 5).forEach(jk => {
      console.log(`  - ${jk}: ${Math.round(byJobKey[jk])} hours`);
    });
  }
  
  await prisma.$disconnect();
}

analyze().catch(console.error);
