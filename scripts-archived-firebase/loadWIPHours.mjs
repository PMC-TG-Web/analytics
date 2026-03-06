import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';
}

const prisma = new PrismaClient();

// Normalize text for matching
function normalize(value) {
  if (!value) return '';
  return value.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Parse WIP month to YYYY-MM format
function parseWIPMonth(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  } catch {
    return null;
  }
}

// Parse percentage
function parsePercent(value) {
  if (!value) return 0;
  const str = value.toString().replace('%', '').trim();
  return parseFloat(str) || 0;
}

// Parse hours
function parseHours(value) {
  if (!value) return 0;
  return parseFloat(value) || 0;
}

async function analyzeMatches() {
  console.log('\n========================================');
  console.log('WIP Hours Import Analysis');
  console.log('========================================\n');

  // Load CSV
  const csvPath = path.join(__dirname, 'WIP2.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  // Debug: show first record
  console.log('Sample record:', JSON.stringify(records[0], null, 2));
  console.log(`📄 Loaded ${records.length} rows from CSV\n`);

  console.log(`📄 Loaded ${records.length} rows from CSV\n`);

  // Load all projects from database
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      projectNumber: true,
      projectName: true,
      customer: true,
      status: true,
      hours: true,
    },
  });

  console.log(`💾 Loaded ${projects.length} projects from database\n`);

  // Build lookup maps
  const projectByName = new Map();
  const projectByCustomerAndName = new Map();

  projects.forEach((p) => {
    const nameKey = normalize(p.projectName);
    const customerKey = normalize(p.customer);
    const combinedKey = `${customerKey}|${nameKey}`;

    // Store by name only
    if (!projectByName.has(nameKey)) {
      projectByName.set(nameKey, []);
    }
    projectByName.get(nameKey).push(p);

    // Store by customer + name
    if (!projectByCustomerAndName.has(combinedKey)) {
      projectByCustomerAndName.set(combinedKey, []);
    }
    projectByCustomerAndName.get(combinedKey).push(p);
  });

  // Analyze matches
  const matched = [];
  const unmatched = [];
  const duplicates = [];

  for (const record of records) {
    const csvCustomer = record.Customer || '';
    const csvProjectName = record.Projectname || '';
    const csvMonth = parseWIPMonth(record.WIPMonth);
    const csvPercent = parsePercent(record['%InMonth']);

    const nameKey = normalize(csvProjectName);
    const customerKey = normalize(csvCustomer);
    const combinedKey = `${customerKey}|${nameKey}`;

    let matchedProjects = projectByCustomerAndName.get(combinedKey) || [];

    // If no exact match, try by name only
    if (matchedProjects.length === 0) {
      matchedProjects = projectByName.get(nameKey) || [];
    }

    // Calculate actual hours from database project hours * CSV percentage
    const calculatedHours = matchedProjects.length === 1 
      ? (matchedProjects[0].hours || 0) * (csvPercent / 100)
      : 0;

    const matchInfo = {
      csvCustomer,
      csvProjectName,
      csvMonth,
      csvPercent,
      csvHours: calculatedHours, // Use calculated hours instead
      matchedProjects: matchedProjects.map(p => ({
        id: p.id,
        customer: p.customer,
        projectName: p.projectName,
        projectNumber: p.projectNumber,
        status: p.status,
        totalHours: p.hours || 0,
      })),
    };

    if (matchedProjects.length === 0) {
      unmatched.push(matchInfo);
    } else if (matchedProjects.length === 1) {
      matched.push(matchInfo);
    } else {
      duplicates.push(matchInfo);
    }
  }

  // Print Summary
  console.log('========================================');
  console.log('MATCH SUMMARY');
  console.log('========================================\n');
  console.log(`✅ Matched (unique):     ${matched.length} rows`);
  console.log(`⚠️  Multiple matches:    ${duplicates.length} rows`);
  console.log(`❌ No match:            ${unmatched.length} rows`);
  console.log(`📊 Total CSV rows:      ${records.length}\n`);

  if (duplicates.length > 0) {
    console.log('========================================');
    console.log('MULTIPLE MATCHES (Manual Review Needed)');
    console.log('========================================\n');
    duplicates.forEach((dup, idx) => {
      console.log(`${idx + 1}. CSV: "${dup.csvCustomer}" / "${dup.csvProjectName}"`);
      dup.matchedProjects.forEach((m, i) => {
        console.log(`   Match ${i + 1}: "${m.customer}" / "${m.projectName}" (${m.status})`);
      });
      console.log('');
    });
  }

  if (unmatched.length > 0) {
    console.log('========================================');
    console.log('UNMATCHED ROWS');
    console.log('========================================\n');
    console.log('First 20 unmatched rows:\n');
    unmatched.slice(0, 20).forEach((row, idx) => {
      console.log(`${idx + 1}. "${row.csvCustomer}" / "${row.csvProjectName}"`);
      console.log(`   Month: ${row.csvMonth}, Percent: ${row.csvPercent}%`);
    });
    if (unmatched.length > 20) {
      console.log(`\n... and ${unmatched.length - 20} more unmatched rows\n`);
    }
  }

  if (matched.length > 0) {
    console.log('\n========================================');
    console.log('MATCHED ROWS (First 20)');
    console.log('========================================\n');
    matched.slice(0, 20).forEach((row, idx) => {
      const proj = row.matchedProjects[0];
      console.log(`${idx + 1}. CSV: "${row.csvProjectName}"`);
      console.log(`   ✅ DB: "${proj.projectName}" (${proj.customer || 'no customer'})`);
      console.log(`   DB Total Hours: ${proj.totalHours.toFixed(1)}`);
      console.log(`   Month: ${row.csvMonth}, Percent: ${row.csvPercent}%, Calculated Hours: ${row.csvHours.toFixed(1)}`);
      console.log('');
    });
    if (matched.length > 20) {
      console.log(`... and ${matched.length - 20} more matched rows\n`);
    }
  }

  // Save reports to files
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const unmatchedPath = path.join(__dirname, `unmatched-wip-${timestamp}.json`);
  const matchedPath = path.join(__dirname, `matched-wip-${timestamp}.json`);

  fs.writeFileSync(unmatchedPath, JSON.stringify(unmatched, null, 2));
  fs.writeFileSync(matchedPath, JSON.stringify(matched, null, 2));

  console.log('\n========================================');
  console.log('REPORTS SAVED');
  console.log('========================================\n');
  console.log(`📄 Matched rows:   ${matchedPath}`);
  console.log(`📄 Unmatched rows: ${unmatchedPath}\n`);

  await prisma.$disconnect();

  return { matched, unmatched, duplicates };
}

async function loadMatches() {
  console.log('\n========================================');
  console.log('LOADING WIP HOURS TO DATABASE');
  console.log('========================================\n');

  // First, analyze to get matches
  const { matched } = await analyzeMatches();

  if (matched.length === 0) {
    console.log('❌ No matched rows to load.\n');
    return;
  }

  console.log(`\n📤 Preparing to load ${matched.length} matched allocations...\n`);

  // Group by project and month
  const groupedByProjectMonth = new Map();
  const groupedByProject = new Map();

  matched.forEach((row) => {
    const proj = row.matchedProjects[0];
    // Always keep all 3 parts of jobKey (customer~projectNumber~projectName)
    // Don't filter out nulls - keep empty strings to match WIP page format
    const jobKey = `${proj.customer || ''}~${proj.projectNumber || ''}~${proj.projectName || ''}`;
    const key = `${jobKey}|${row.csvMonth}`;

    // Group for ActiveSchedule (weekly hours)
    if (!groupedByProjectMonth.has(key)) {
      groupedByProjectMonth.set(key, {
        jobKey,
        customer: proj.customer,
        projectNumber: proj.projectNumber,
        projectName: proj.projectName,
        month: row.csvMonth,
        totalHours: 0,
        weeks: [
          { weekNumber: 1, hours: 0 },
          { weekNumber: 2, hours: 0 },
          { weekNumber: 3, hours: 0 },
          { weekNumber: 4, hours: 0 },
          { weekNumber: 5, hours: 0 },
        ],
      });
    }

    const data = groupedByProjectMonth.get(key);
    data.totalHours += row.csvHours;
    // Put all hours in week 1 (they'll be allocated to first weekday)
    data.weeks[0].hours += row.csvHours;

    // Group for Schedule table (monthly percentages)
    if (!groupedByProject.has(jobKey)) {
      groupedByProject.set(jobKey, {
        jobKey,
        customer: proj.customer || 'Unknown',
        projectNumber: proj.projectNumber || '',
        projectName: proj.projectName || 'Unnamed Project',
        status: proj.status || 'In Progress',
        totalHours: proj.totalHours || 0,
        allocations: {},
      });
    }

    const projectData = groupedByProject.get(jobKey);
    projectData.allocations[row.csvMonth] = row.csvPercent;
  });

  let loaded = 0;
  let failed = 0;
  let schedulesLoaded = 0;
  let schedulesFailed = 0;

  // First, save to Schedule table (monthly percentages)
  console.log(`\n📋 Saving ${groupedByProject.size} project schedules (monthly percentages)...\n`);
  
  for (const [jobKey, data] of groupedByProject.entries()) {
    try {
      // Convert allocations object to array format expected by API
      const allocationsArray = Object.entries(data.allocations).map(([month, percent]) => ({
        month,
        percent,
      }));

      const response = await fetch('http://localhost:3000/api/scheduling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          allocations: allocationsArray,
        }),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`✅ ${data.jobKey}: ${Object.keys(data.allocations).length} months`);
        schedulesLoaded++;
      } else {
        console.log(`❌ Failed: ${data.jobKey}`);
        console.log(`   Error: ${result.error || result.message || 'Unknown error'}`);
        schedulesFailed++;
      }
    } catch (error) {
      console.log(`❌ Error loading ${data.jobKey}:`);
      console.log(`   ${error.message}`);
      schedulesFailed++;
    }
  }

  console.log(`\n📅 Saving ${groupedByProjectMonth.size} monthly hour allocations...\n`);

  for (const [key, data] of groupedByProjectMonth.entries()) {
    try {
      const response = await fetch('http://localhost:3000/api/long-term-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        console.log(`✅ ${data.jobKey} / ${data.month}: ${data.totalHours.toFixed(1)} hours`);
        loaded++;
      } else {
        console.log(`❌ Failed: ${data.jobKey} / ${data.month}`);
        console.log(`   Error: ${result.error || result.message || 'Unknown error'}`);
        if (result.details) console.log(`   Details: ${JSON.stringify(result.details)}`);
        failed++;
      }
    } catch (error) {
      console.log(`❌ Error loading ${data.jobKey} / ${data.month}:`);
      console.log(`   ${error.message}`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Schedule Table (Monthly %):`);
  console.log(`  ✅ Successfully loaded: ${schedulesLoaded}`);
  console.log(`  ❌ Failed: ${schedulesFailed}`);
  console.log(`\nActiveSchedule Table (Daily Hours):`);
  console.log(`  ✅ Successfully loaded: ${loaded}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`========================================\n`);

  await prisma.$disconnect();
}

const args = process.argv.slice(2);
const command = args[0];

if (command === 'load') {
  loadMatches().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
} else {
  analyzeMatches().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
