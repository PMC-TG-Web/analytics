import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function fixMechanicsburg() {
  console.log('Fixing Mechanicsburg Volunteer Fire Department...\n');
  
  // Delete wrong schedules (the ones with no customer or Unknown customer)
  const deletedSchedules = await prisma.schedule.deleteMany({
    where: {
      projectName: 'Mechanicsburg Volunteer Fire Department',
      OR: [
        { customer: null },
        { customer: '' },
        { customer: 'Unknown' },
      ],
    },
  });
  
  console.log(`Deleted ${deletedSchedules.count} incorrect schedule entries\n`);
  
  // Delete wrong ActiveSchedule entries (jobKey with empty customer)
  const deletedActive = await prisma.activeSchedule.deleteMany({
    where: {
      jobKey: {
        startsWith: '~mechanicsburgvolunteerfired',
      },
    },
  });
  
  console.log(`Deleted ${deletedActive.count} incorrect ActiveSchedule entries\n`);
  
  // Get the correct project
  const correctProject = await prisma.project.findFirst({
    where: {
      projectName: 'Mechanicsburg Volunteer Fire Department',
      customer: 'Centurion Construction Group, LLC',
    },
  });
  
  if (!correctProject) {
    console.error('❌ Could not find correct project!');
    await prisma.$disconnect();
    return;
  }
  
  console.log('✅ Found correct project:');
  console.log(`   Customer: ${correctProject.customer}`);
  console.log(`   Number: ${correctProject.projectNumber}`);
  console.log(`   Hours: ${correctProject.hours}\n`);
  
  // Normalize for jobKey
  const normalize = (v) => v ? v.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const jobKey = `${normalize(correctProject.customer)}~${normalize(correctProject.projectNumber)}~${normalize(correctProject.projectName)}`;
  
  // Create correct Schedule
  const allocations = {
    '2025-12': 18,
    '2026-02': 18,
    '2026-03': 20,
    '2026-04': 15,
    '2026-05': 29,
  };
  
  const schedule = await prisma.schedule.upsert({
    where: { jobKey },
    create: {
      jobKey,
      projectId: correctProject.id,
      customer: correctProject.customer,
      projectNumber: correctProject.projectNumber,
      projectName: correctProject.projectName,
      status: correctProject.status,
      totalHours: correctProject.hours,
      allocations,
    },
    update: {
      allocations,
      totalHours: correctProject.hours,
    },
  });
  
  console.log('✅ Created/updated correct Schedule entry\n');
  
  // Create ActiveSchedule entries with calculated hours
  const months = [
    { month: '2025-12', pct: 18, date: '2025-12-01' },
    { month: '2026-02', pct: 18, date: '2026-02-02' },
    { month: '2026-03', pct: 20, date: '2026-03-02' },
    { month: '2026-04', pct: 15, date: '2026-04-01' },
    { month: '2026-05', pct: 29, date: '2026-05-01' },
  ];
  
  for (const { month, pct, date } of months) {
    const hours = (correctProject.hours || 0) * (pct / 100);
    
    await prisma.activeSchedule.upsert({
      where: {
        jobKey_scopeOfWork_date: {
          jobKey,
          scopeOfWork: 'Project Work',
          date,
        },
      },
      create: {
        jobKey,
        projectId: correctProject.id,
        scopeOfWork: 'Project Work',
        date,
        hours,
        source: 'schedules',
      },
      update: {
        hours,
      },
    });
    
    console.log(`✅ ${month}: ${pct}% = ${hours.toFixed(1)} hours (date: ${date})`);
  }
  
  console.log('\n✅ Mechanicsburg Volunteer Fire Department fixed!');
  
  await prisma.$disconnect();
}

fixMechanicsburg();
