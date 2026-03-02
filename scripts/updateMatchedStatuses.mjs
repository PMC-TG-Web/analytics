// Update status to "In Progress" for non-Complete matched projects

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function updateStatuses() {
  console.log('\n========================================');
  console.log('UPDATING PROJECT STATUSES');
  console.log('========================================\n');

  // Find the most recent matched file
  const scriptsDir = __dirname;
  const files = fs.readdirSync(scriptsDir)
    .filter(f => f.startsWith('matched-wip-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.log('❌ No matched-wip-*.json files found');
    process.exit(1);
  }

  const matchedFile = join(scriptsDir, files[0]);
  const matched = JSON.parse(fs.readFileSync(matchedFile, 'utf-8'));

  // Group by project
  const projectMap = new Map();
  matched.forEach(row => {
    const proj = row.matchedProjects[0];
    const key = proj.id;
    if (!projectMap.has(key)) {
      projectMap.set(key, {
        id: proj.id,
        customer: proj.customer,
        projectNumber: proj.projectNumber,
        projectName: proj.projectName,
        status: proj.status,
      });
    }
  });

  // Find projects that are NOT "Complete" and NOT already "In Progress"
  const projectsToUpdate = Array.from(projectMap.values()).filter(
    p => p.status !== 'Complete' && p.status !== 'In Progress'
  );

  console.log(`Found ${projectsToUpdate.length} projects to update:\n`);

  if (projectsToUpdate.length === 0) {
    console.log('✅ No projects need updating - all are either Complete or In Progress');
    await prisma.$disconnect();
    return;
  }

  // Show what will be updated
  projectsToUpdate.forEach((p, idx) => {
    console.log(`${idx + 1}. ${p.projectName}`);
    console.log(`   Customer: ${p.customer || 'N/A'}`);
    console.log(`   Current Status: "${p.status}" → New Status: "In Progress"`);
    console.log('');
  });

  console.log('========================================\n');

  // Update each project
  let updated = 0;
  let failed = 0;

  for (const project of projectsToUpdate) {
    try {
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'In Progress' },
      });
      console.log(`✅ Updated: ${project.projectName}`);
      updated++;
    } catch (error) {
      console.error(`❌ Failed to update ${project.projectName}:`, error.message);
      failed++;
    }
  }

  console.log('\n========================================');
  console.log('SUMMARY');
  console.log('========================================\n');
  console.log(`✅ Successfully updated: ${updated}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total "In Progress" projects now: ${Array.from(projectMap.values()).filter(p => p.status === 'In Progress').length + updated}`);

  await prisma.$disconnect();
}

updateStatuses().catch(console.error);
