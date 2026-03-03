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

async function analyzeAndLoadWIP2() {
  console.log('\n========================================');
  console.log('WIP2 Import Analysis & Load');
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

  console.log('Sample record:', JSON.stringify(records[0], null, 2));
  console.log(`📄 Loaded ${records.length} rows from WIP2.csv\n`);

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

    if (!csvMonth || csvPercent === 0) {
      console.log(`⚠️  Skipping invalid row: ${csvCustomer} / ${csvProjectName}`);
      continue;
    }

    const nameKey = normalize(csvProjectName);
    const customerKey = normalize(csvCustomer);
    const combinedKey = `${customerKey}|${nameKey}`;

    // Try exact match first (customer + name)
    let matchedProjects = projectByCustomerAndName.get(combinedKey) || [];

    // If no exact match, try by name only
    if (matchedProjects.length === 0) {
      matchedProjects = projectByName.get(nameKey) || [];
    }

    const matchInfo = {
      csvCustomer,
      csvProjectName,
      csvMonth,
      csvPercent,
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
    unmatched.forEach((row, idx) => {
      console.log(`${idx + 1}. "${row.csvCustomer}" / "${row.csvProjectName}"`);
      console.log(`   Month: ${row.csvMonth}, Percent: ${row.csvPercent}%`);
    });
    console.log('');
  }

  if (matched.length > 0) {
    console.log('\n========================================');
    console.log('MATCHED ROWS (Will be loaded)');
    console.log('========================================\n');
    matched.forEach((row, idx) => {
      const proj = row.matchedProjects[0];
      console.log(`${idx + 1}. CSV: "${row.csvCustomer}" / "${row.csvProjectName}"`);
      console.log(`   ✅ DB: "${proj.projectName}" (${proj.customer})`);
      console.log(`   Month: ${row.csvMonth}, Percent: ${row.csvPercent}%`);
      console.log('');
    });
  }

  // Load matched data to schedules
  if (matched.length === 0) {
    console.log('❌ No matched rows to load.\n');
    await prisma.$disconnect();
    return;
  }

  console.log('\n========================================');
  console.log('LOADING TO SCHEDULES');
  console.log('========================================\n');

  // Group matched entries by project
  const projectAllocations = new Map();
  
  for (const match of matched) {
    const project = match.matchedProjects[0];
    const monthYear = match.csvMonth;
    const percentage = match.csvPercent;
    
    if (!projectAllocations.has(project.id)) {
      projectAllocations.set(project.id, {
        project,
        allocations: {}
      });
    }
    
    projectAllocations.get(project.id).allocations[monthYear] = percentage;
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const [projectId, data] of projectAllocations) {
    const { project, allocations } = data;
    const jobKey = `${normalize(project.customer)}~${normalize(project.projectNumber)}~${normalize(project.projectName)}`;

    try {
      // Find existing schedule by jobKey
      const existing = await prisma.schedule.findUnique({
        where: { jobKey },
      });

      if (existing) {
        // Merge with existing allocations
        const existingAllocations = existing.allocations || {};
        const mergedAllocations = { ...existingAllocations, ...allocations };
        
        await prisma.schedule.update({
          where: { id: existing.id },
          data: {
            allocations: mergedAllocations,
            updatedAt: new Date(),
          },
        });
        console.log(`   ✏️  Updated: ${project.projectName}`);
        Object.entries(allocations).forEach(([month, pct]) => {
          console.log(`      ${month}: ${pct}%`);
        });
        updated++;
      } else {
        // Create new schedule
        await prisma.schedule.create({
          data: {
            jobKey,
            projectId: project.id,
            customer: project.customer,
            projectNumber: project.projectNumber,
            projectName: project.projectName,
            status: project.status,
            totalHours: project.totalHours,
            allocations: allocations,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        console.log(`   ✨ Created: ${project.projectName}`);
        Object.entries(allocations).forEach(([month, pct]) => {
          console.log(`      ${month}: ${pct}%`);
        });
        created++;
      }
    } catch (error) {
      console.error(`   ❌ Error loading ${project.projectName}:`, error.message);
      errors++;
    }
  }

  console.log('\n========================================');
  console.log('LOAD SUMMARY');
  console.log('========================================\n');
  console.log(`✨ Created:  ${created} schedule entries`);
  console.log(`✏️  Updated:  ${updated} schedule entries`);
  console.log(`❌ Errors:   ${errors}`);
  console.log(`📊 Total:    ${created + updated} successful\n`);

  await prisma.$disconnect();
}

analyzeAndLoadWIP2();
