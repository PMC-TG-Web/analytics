import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function check() {
  console.log('=== CHECKING ACTIVE SCHEDULE ===\n');

  // 1. Total count
  const total = await prisma.activeSchedule.count();
  console.log(`Total ActiveSchedule entries: ${total}\n`);
  
  // 2. Get all unique jobKeys
  const allJobKeys = await prisma.activeSchedule.findMany({
    select: { jobKey: true },
    distinct: ['jobKey'],
  });
  console.log(`Unique jobKeys: ${allJobKeys.length}\n`);

  // 3. Look specifically for Westminster
  console.log('=== SEARCHING FOR WESTMINSTER ===');
  
  const westminsterEntries = await prisma.activeSchedule.findMany({
    where: {
      OR: [
        { jobKey: { contains: 'Westminster', mode: 'insensitive' } },
        { jobKey: { contains: '2505', mode: 'insensitive' } },
      ],
    },
    select: { jobKey: true, hours: true, date: true, scopeOfWork: true },
  });

  if (westminsterEntries.length === 0) {
    console.log('❌ No Westminster entries found\n');
    
    // Show sample jobKeys to see the pattern
    console.log('Sample jobKeys in database:');
    allJobKeys.slice(0, 15).forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.jobKey}`);
    });
  } else {
    console.log(`✅ Found ${westminsterEntries.length} Westminster entries\n`);
    
    // Group by jobKey
    const byJobKey = new Map();
    westminsterEntries.forEach(e => {
      if (!byJobKey.has(e.jobKey)) {
        byJobKey.set(e.jobKey, []);
      }
      byJobKey.get(e.jobKey).push(e);
    });

    byJobKey.forEach((entries, jobKey) => {
      const totalHours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);
      const scopes = [...new Set(entries.map(e => e.scopeOfWork))];
      console.log(`📋 JobKey: ${jobKey}`);
      console.log(`   Total Hours: ${totalHours.toFixed(1)}`);
      console.log(`   Entries: ${entries.length}`);
      console.log(`   Scopes: ${scopes.join(', ')}`);
      console.log('');
    });
  }

  // 4. Check Gantt V2 Westminster project
  console.log('\n=== GANTT V2 WESTMINSTER PROJECT ===');
  try {
    const ganttProjects = await prisma.$queryRawUnsafe(`
      SELECT id, project_name, project_number, customer
      FROM gantt_v2_projects
      WHERE project_name LIKE '%Westminster%'
      LIMIT 5
    `);

    if (!ganttProjects || ganttProjects.length === 0) {
      console.log('❌ No Westminster projects in Gantt V2');
    } else {
      ganttProjects.forEach(p => {
        console.log(`✅ Project: ${p.project_name}`);
        console.log(`   Number: ${p.project_number}`);
        console.log(`   Customer: ${p.customer}`);
        console.log(`   ID: ${p.id}\n`);
      });
    }
  } catch (error) {
    console.log('Error checking Gantt V2:', error.message);
  }
  
  await prisma.$disconnect();
}

check();
