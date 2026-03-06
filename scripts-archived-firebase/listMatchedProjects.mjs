// List matched projects with their statuses

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find the most recent matched file
const scriptsDir = __dirname;
const files = fs.readdirSync(scriptsDir)
  .filter(f => f.startsWith('matched-wip-') && f.endsWith('.json'))
  .sort()
  .reverse();

if (files.length === 0) {
  console.log('No matched-wip-*.json files found');
  process.exit(1);
}

const matchedFile = path.join(scriptsDir, files[0]);
console.log(`Reading: ${files[0]}\n`);

const matched = JSON.parse(fs.readFileSync(matchedFile, 'utf-8'));

// Group by project
const projectMap = new Map();

matched.forEach(row => {
  const proj = row.matchedProjects[0];
  const key = `${proj.customer}~${proj.projectNumber}~${proj.projectName}`;
  
  if (!projectMap.has(key)) {
    projectMap.set(key, {
      customer: proj.customer,
      projectNumber: proj.projectNumber,
      projectName: proj.projectName,
      status: proj.status,
      totalHours: proj.totalHours,
      allocations: [],
    });
  }
  
  projectMap.get(key).allocations.push({
    month: row.csvMonth,
    percent: row.csvPercent,
    hours: row.csvHours,
  });
});

console.log('========================================');
console.log(`MATCHED PROJECTS (${projectMap.size} total)`);
console.log('========================================\n');

// Sort by status then by customer
const projects = Array.from(projectMap.values()).sort((a, b) => {
  if (a.status !== b.status) return a.status.localeCompare(b.status);
  return (a.customer || '').localeCompare(b.customer || '');
});

// Group by status
const byStatus = {};
projects.forEach(p => {
  if (!byStatus[p.status]) byStatus[p.status] = [];
  byStatus[p.status].push(p);
});

console.log('SUMMARY BY STATUS:');
Object.entries(byStatus).forEach(([status, projs]) => {
  console.log(`  ${status}: ${projs.length} projects`);
});

console.log('\n========================================');
console.log('DETAILED LIST');
console.log('========================================\n');

Object.entries(byStatus).forEach(([status, projs]) => {
  console.log(`\n━━━ ${status.toUpperCase()} (${projs.length}) ━━━\n`);
  
  projs.forEach((p, idx) => {
    console.log(`${idx + 1}. ${p.projectName}`);
    console.log(`   Customer: ${p.customer}`);
    console.log(`   Project #: ${p.projectNumber || 'N/A'}`);
    console.log(`   Total Hours: ${p.totalHours.toFixed(1)}`);
    console.log(`   Allocations: ${p.allocations.length} months`);
    
    // Show allocation summary
    const allocStr = p.allocations
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(a => `${a.month} (${a.percent}%)`)
      .join(', ');
    console.log(`   Months: ${allocStr}`);
    console.log('');
  });
});

// Show which will appear on WIP page
console.log('\n========================================');
console.log('WIP PAGE VISIBILITY');
console.log('========================================\n');

const inProgressProjects = byStatus['In Progress'] || [];
console.log(`✅ WILL SHOW on WIP page: ${inProgressProjects.length} projects (status = "In Progress")`);
inProgressProjects.forEach((p, idx) => {
  console.log(`   ${idx + 1}. ${p.projectName}`);
});

const otherStatuses = Object.entries(byStatus).filter(([s]) => s !== 'In Progress');
if (otherStatuses.length > 0) {
  console.log(`\n❌ WILL NOT SHOW on WIP page: ${projects.length - inProgressProjects.length} projects (wrong status)`);
  otherStatuses.forEach(([status, projs]) => {
    console.log(`\n   ${status}: ${projs.length} projects`);
    projs.forEach((p, idx) => {
      console.log(`      ${idx + 1}. ${p.projectName}`);
    });
  });
}
