// Test WIP page data flow

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function test() {
  console.log('\n========================================');
  console.log('SIMULATING WIP PAGE DATA FLOW');
  console.log('\n========================================\n');

  // Step 1: Get all projects
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      hours: true,
      projectArchived: true,
    },
  });

  console.log(`📊 Total projects: ${projects.length}\n`);

  // Step 2: Filter to qualifying projects (In Progress, not archived)
  const qualifyingProjects = projects.filter((p) => {
    if (p.projectArchived) return false;
    const status = (p.status || '').toString().toLowerCase().trim();
    if (status !== 'in progress') return false;

    const customer = (p.customer ?? '').toString().toLowerCase();
    if (customer.includes('sop inc')) return false;
    const projectName = (p.projectName ?? '').toString().toLowerCase();
    if (projectName === 'pmc operations') return false;
    if (projectName === 'pmc shop time') return false;
    if (projectName === 'pmc test project') return false;
    if (projectName.includes('sandbox') || projectName.includes('raymond king')) return false;

    return true;
  });

  console.log(`✅ Qualifying projects (In Progress, not archived): ${qualifyingProjects.length}\n`);

  // Step 3: Get schedules
  const schedules = await prisma.schedule.findMany({
    select: {
      jobKey: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      status: true,
      totalHours: true,
      allocations: true,
    },
  });

  console.log(`📅 Total schedules: ${schedules.length}\n`);

  // Step 4: Filter to In Progress schedules
  const inProgressSchedules = schedules.filter((s) => {
    const status = (s.status || '').toString().toLowerCase().trim();
    return status === 'in progress';
  });

  console.log(`✅ In Progress schedules: ${inProgressSchedules.length}\n`);

  // Step 5: Build jobKey lookup for qualifyingProjects
  const qualifyingJobKeys = new Set();
  qualifyingProjects.forEach(p => {
    const jobKey = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    qualifyingJobKeys.add(jobKey);
  });

  // Also add schedules with "in progress" status
  schedules.forEach(s => {
    const status = (s.status || '').toString().toLowerCase().trim();
    if (status !== 'in progress') return;
    const key = s.jobKey || `${s.customer || ''}~${s.projectNumber || ''}~${s.projectName || ''}`;
    const isExcluded = (s.customer || '').toLowerCase().includes('sop inc') ||
                      (s.projectName || '').toLowerCase().includes('sandbox');
    if (!isExcluded) qualifyingJobKeys.add(key);
  });

  console.log(`🔑 Total qualifying jobKeys: ${qualifyingJobKeys.size}\n`);

  // Step 6: Check which schedules should show data
  let schedulesProcessed = 0;
  const monthlyData = {};

  inProgressSchedules.forEach((schedule) => {
    const jobKey = schedule.jobKey;
    
    // Check if qualifying
    if (!qualifyingJobKeys.has(jobKey)) {
      console.log(`   ❌ Skipped (not qualifying): ${jobKey}`);
      return;
    }

    // Parse allocations
    let allocations = [];
    if (schedule.allocations) {
      if (Array.isArray(schedule.allocations)) {
        allocations = schedule.allocations;
      } else if (typeof schedule.allocations === 'object') {
        allocations = Object.entries(schedule.allocations).map(([month, percent]) => ({
          month,
          percent,
        }));
      }
    }

    if (allocations.length > 0) {
      schedulesProcessed++;
      allocations.forEach(alloc => {
        const allocatedHours = schedule.totalHours * (alloc.percent / 100);
        if (!monthlyData[alloc.month]) monthlyData[alloc.month] = 0;
        monthlyData[alloc.month] += allocatedHours;
      });
    }
  });

  console.log(`📈 Schedules that added data: ${schedulesProcessed}\n`);
  console.log(`📅 Months with data: ${Object.keys(monthlyData).length}\n`);

  if (Object.keys(monthlyData).length > 0) {
    console.log('Monthly breakdown:');
    Object.keys(monthlyData).sort().slice(0, 6).forEach(month => {
      console.log(`  ${month}: ${monthlyData[month].toFixed(1)} hours`);
    });
    if (Object.keys(monthlyData).length > 6) {
      console.log(`  ... and ${Object.keys(monthlyData).length - 6} more months`);
    }
  } else {
    console.log('❌ NO MONTHLY DATA - WIP page would show nothing!');
  }

  await prisma.$disconnect();
}

test().catch(console.error);
