#!/usr/bin/env node

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('='.repeat(60));
console.log('PMC Analytics Data Export Pipeline');
console.log('='.repeat(60));

try {
  console.log('\n[1/2] Exporting Status.csv with PMC breakdown...');
  console.log('-'.repeat(60));
  execSync('node scripts/exportStatusWithPMCBreakdown.mjs', { stdio: 'inherit', cwd: __dirname + '/..' });
  
  console.log('\n[2/2] Calculating actual hours from project data...');
  console.log('-'.repeat(60));
  execSync('node scripts/calculateActualHours.mjs', { stdio: 'inherit', cwd: __dirname + '/..' });
  
  console.log('\n' + '='.repeat(60));
  console.log('✓ Export pipeline complete!');
  console.log('='.repeat(60));
  console.log('\nData updated:');
  console.log('  ✓ public/projects-backup.json - 335 projects with PMC breakdown');
  console.log('  ✓ src/lib/kpiCardDefaults.ts - Revenue Actual Hours by month');
  console.log('\nYour dashboard is now synced with the latest data.');
  
} catch (error) {
  console.error('\n' + '='.repeat(60));
  console.error('❌ Export pipeline failed');
  console.error('='.repeat(60));
  process.exit(1);
}
