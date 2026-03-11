/**
 * syncDbToBidCsvExact.cjs
 *
 * Make Project table match Bid_Distro-Preconstruction (1).csv exactly by key:
 *   projectName + customer + status
 *
 * Behavior:
 * 1) Aggregate CSV rows by key and sum sales/cost/hours/labor fields
 * 2) For each CSV key:
 *    - update one existing DB row (or create if missing)
 *    - archive any extra DB duplicates for that same key
 * 3) Archive every DB key that does not exist in CSV
 *
 * This aligns dashboard-level analytics with the CSV source of truth.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (parts[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function norm(v) {
  return (v || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

function makeKey(projectName, customer, status) {
  return `${norm(projectName)}||${norm(customer)}||${norm(status)}`;
}

function parseNum(v) {
  if (!v) return 0;
  const cleaned = String(v).replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function main() {
  const csvPath = path.join(__dirname, '..', 'Bid_Distro-Preconstruction (1).csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }

  console.log('Parsing CSV...');
  const rawRows = parseCsv(csvPath);
  console.log(`  CSV rows: ${rawRows.length}`);

  // Fill-forward blank values
  let lastProjectName = '';
  let lastCustomer = '';
  let lastStatus = '';
  let lastProjectNumber = '';
  let lastEstimator = '';

  const csvGroups = new Map();

  for (const r of rawRows) {
    const projectName = r.projectName?.trim();
    const customer = r.customer?.trim();
    const status = r.status?.trim();
    const projectNumber = r.projectNumber?.trim();
    const estimator = r.estimator?.trim();

    if (projectName) lastProjectName = projectName;
    if (customer) lastCustomer = customer;
    if (status) lastStatus = status;
    if (projectNumber) lastProjectNumber = projectNumber;
    if (estimator) lastEstimator = estimator;

    if (!lastProjectName || !lastCustomer || !lastStatus) continue;

    const key = makeKey(lastProjectName, lastCustomer, lastStatus);
    if (!csvGroups.has(key)) {
      csvGroups.set(key, {
        projectName: lastProjectName,
        customer: lastCustomer,
        status: lastStatus,
        projectNumber: lastProjectNumber || null,
        estimator: lastEstimator || null,
        sales: 0,
        cost: 0,
        hours: 0,
        laborSales: 0,
        laborCost: 0,
        dateCreated: parseDate(r.dateCreated),
        dateUpdated: parseDate(r.dateUpdated || r.ProjectUpdateDate),
        lineCount: 0,
      });
    }

    const g = csvGroups.get(key);
    g.sales += parseNum(r.sales);
    g.cost += parseNum(r.cost);
    g.hours += parseNum(r.hours);
    g.laborSales += parseNum(r.LaborSales);
    g.laborCost += parseNum(r.LaborCost);
    g.lineCount += 1;

    const dCreated = parseDate(r.dateCreated);
    const dUpdated = parseDate(r.dateUpdated || r.ProjectUpdateDate);
    if (dCreated && (!g.dateCreated || dCreated > g.dateCreated)) g.dateCreated = dCreated;
    if (dUpdated && (!g.dateUpdated || dUpdated > g.dateUpdated)) g.dateUpdated = dUpdated;
  }

  console.log(`  CSV grouped keys: ${csvGroups.size}`);

  console.log('Loading DB projects...');
  const dbRows = await prisma.project.findMany({
    select: {
      id: true,
      projectName: true,
      customer: true,
      status: true,
      sales: true,
      cost: true,
      hours: true,
      laborSales: true,
      laborCost: true,
      projectArchived: true,
      customFields: true,
      projectNumber: true,
      estimator: true,
      dateCreated: true,
      dateUpdated: true,
    }
  });

  const dbByKey = new Map();
  for (const row of dbRows) {
    const key = makeKey(row.projectName, row.customer, row.status);
    if (!dbByKey.has(key)) dbByKey.set(key, []);
    dbByKey.get(key).push(row);
  }

  console.log(`  DB keys: ${dbByKey.size}`);

  let updated = 0;
  let created = 0;
  let archivedDuplicates = 0;
  let archivedNotInCsv = 0;

  // Apply CSV groups to DB
  for (const [key, csv] of csvGroups.entries()) {
    const dbMatches = dbByKey.get(key) || [];

    if (dbMatches.length > 0) {
      // Keep first row active, archive any extras
      const [keeper, ...extras] = dbMatches;

      const existingCf = (keeper.customFields && typeof keeper.customFields === 'object' && !Array.isArray(keeper.customFields))
        ? keeper.customFields
        : {};

      await prisma.project.update({
        where: { id: keeper.id },
        data: {
          projectName: csv.projectName,
          customer: csv.customer,
          status: csv.status,
          projectNumber: csv.projectNumber,
          estimator: csv.estimator,
          sales: csv.sales,
          cost: csv.cost,
          hours: csv.hours,
          laborSales: csv.laborSales,
          laborCost: csv.laborCost,
          dateCreated: csv.dateCreated,
          dateUpdated: csv.dateUpdated,
          projectArchived: false,
          customFields: {
            ...existingCf,
            source: 'Bid_Distro-Preconstruction.csv',
            csvSyncExact: true,
            csvLineCount: csv.lineCount,
          },
        },
      });
      updated++;

      for (const ex of extras) {
        await prisma.project.update({
          where: { id: ex.id },
          data: { projectArchived: true },
        });
        archivedDuplicates++;
      }
    } else {
      await prisma.project.create({
        data: {
          projectName: csv.projectName,
          customer: csv.customer,
          status: csv.status,
          projectNumber: csv.projectNumber,
          estimator: csv.estimator,
          sales: csv.sales,
          cost: csv.cost,
          hours: csv.hours,
          laborSales: csv.laborSales,
          laborCost: csv.laborCost,
          dateCreated: csv.dateCreated,
          dateUpdated: csv.dateUpdated,
          projectArchived: false,
          customFields: {
            source: 'Bid_Distro-Preconstruction.csv',
            csvSyncExact: true,
            csvLineCount: csv.lineCount,
          },
        },
      });
      created++;
    }
  }

  // Archive DB keys not present in CSV
  const csvKeys = new Set(csvGroups.keys());
  for (const [key, rows] of dbByKey.entries()) {
    if (csvKeys.has(key)) continue;
    for (const row of rows) {
      if (!row.projectArchived) {
        await prisma.project.update({
          where: { id: row.id },
          data: { projectArchived: true },
        });
        archivedNotInCsv++;
      }
    }
  }

  console.log('\nSync complete:');
  console.log(`  Updated existing rows: ${updated}`);
  console.log(`  Created new rows:      ${created}`);
  console.log(`  Archived duplicates:   ${archivedDuplicates}`);
  console.log(`  Archived not-in-CSV:   ${archivedNotInCsv}`);
}

main()
  .catch((err) => {
    console.error('Sync failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
