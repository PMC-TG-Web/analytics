// Check Washburn Dam hour aggregation

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('WASHBURN DAM HOUR AGGREGATION CHECK');
console.log('========================================\n');

// 1. Find all Washburn Dam projects
const projects = await prisma.project.findMany({
  where: {
    OR: [
      { projectName: { contains: 'Washburn', mode: 'insensitive' } },
      { projectName: { contains: 'Washburn Dam', mode: 'insensitive' } },
    ]
  },
  select: {
    id: true,
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    hours: true,
  }
});

console.log(`Found ${projects.length} Washburn project(s) in Project table:\n`);

let totalProjectHours = 0;
projects.forEach((p, i) => {
  const hours = Number(p.hours) || 0;
  totalProjectHours += hours;
  
  console.log(`${i + 1}. ${p.customer} - ${p.projectNumber || '(no number)'} - ${p.projectName}`);
  console.log(`   Status: ${p.status}`);
  console.log(`   Hours: ${p.hours || 0}`);
  console.log('');
});

console.log(`Total hours across all Washburn projects: ${totalProjectHours}\n`);

// 2. Check Schedule table
const schedules = await prisma.schedule.findMany({
  where: {
    OR: [
      { projectName: { contains: 'Washburn', mode: 'insensitive' } },
    ]
  },
  select: {
    jobKey: true,
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    totalHours: true,
    allocations: true,
  }
});

console.log('========================================');
console.log(`Found ${schedules.length} Washburn schedule(s) in Schedule table:\n`);

schedules.forEach((s, i) => {
  console.log(`${i + 1}. JobKey: ${s.jobKey}`);
  console.log(`   Customer: ${s.customer}`);
  console.log(`   Project #: ${s.projectNumber}`);
  console.log(`   Status: ${s.status}`);
  console.log(`   Total Hours: ${s.totalHours}`);
  console.log(`   Allocations: ${JSON.stringify(s.allocations)}`);
  console.log('');
});

// 3. Calculate what it SHOULD be
console.log('========================================');
console.log('EXPECTED CALCULATION:');
console.log('========================================\n');

if (projects.length > 0 && schedules.length > 0) {
  const schedule = schedules[0];
  const projectHours = projects.reduce((sum, p) => {
    return sum + (Number(p.hours) || 0);
  }, 0);
  
  console.log(`Project Table Total Hours: ${projectHours}`);
  console.log(`Schedule Table Total Hours: ${schedule.totalHours}`);
  console.log(`\nMatch: ${projectHours === schedule.totalHours ? '✅ YES' : '❌ NO'}`);
  
  if (projectHours !== schedule.totalHours) {
    console.log(`\n⚠️  MISMATCH: Schedule shows ${schedule.totalHours} but should be ${projectHours}`);
  }
}

// 4. Check if there's CSV data for Washburn
console.log('\n========================================');
console.log('CSV IMPORT MATCH (if exists):');
console.log('========================================\n');

import { readFileSync } from 'fs';

try {
  const csvPath = join(__dirname, '..', 'WIPHours.csv');
  const csvContent = readFileSync(csvPath, 'utf8');
  const lines = csvContent.split('\n');
  
  const washburnLines = lines.filter(line => 
    line.toLowerCase().includes('washburn')
  );
  
  if (washburnLines.length > 0) {
    console.log(`Found ${washburnLines.length} line(s) in WIPHours.csv:\n`);
    washburnLines.forEach(line => console.log(line));
  } else {
    console.log('No Washburn entries found in WIPHours.csv');
  }
} catch (error) {
  console.log('Could not read WIPHours.csv:', error.message);
}

await prisma.$disconnect();

console.log('\n========================================');
console.log('DONE');
console.log('========================================\n');
