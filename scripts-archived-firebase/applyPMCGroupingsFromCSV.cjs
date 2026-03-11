/**
 * applyPMCGroupingsFromCSV.cjs
 *
 * Reads Bid_Distro-Preconstruction (1).csv (full line-item export) and
 * PMCGrouping.csv (CostItem → PMCGroup lookup), then for every project in
 * the DB computes the per-PMCGroup hour breakdown and writes it back.
 *
 * This covers BOTH:
 *   - The 340 CSV-imported projects that have no lineItems in the DB
 *   - The 108 projects that already have lineItems (overwrites with CSV data)
 *
 * Match key: (projectName.toLowerCase().trim(), customer.toLowerCase().trim())
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const prisma = new PrismaClient();

// ── Simple CSV parser that handles quoted fields ──────────────────────────
function parseCSV(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim().replace(/^"|"$/g, '');
    });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
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

// Strip currency formatting and return number
function parseNum(val) {
  if (!val) return 0;
  const cleaned = val.toString().replace(/[$,\s]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

async function main() {
  const root = path.join(__dirname, '..');
  const bidCsvPath = path.join(root, 'Bid_Distro-Preconstruction (1).csv');
  const pmcCsvPath = path.join(__dirname, 'PMCGrouping.csv');

  if (!fs.existsSync(bidCsvPath)) {
    console.error('Bid_Distro-Preconstruction (1).csv not found at', bidCsvPath);
    process.exit(1);
  }
  if (!fs.existsSync(pmcCsvPath)) {
    console.error('PMCGrouping.csv not found at', pmcCsvPath);
    process.exit(1);
  }

  // ── Build CostItem → PMCGroup lookup ──────────────────────────────────
  console.log('Loading PMCGrouping.csv...');
  const pmcRows = parseCSV(pmcCsvPath);
  const costItemMap = new Map(); // normalised costItem → pmcGroup
  for (const row of pmcRows) {
    const costItem = (row['CostItem'] || row['Costitems'] || '').trim();
    const pmcGroup = (row['PMCGroup'] || '').trim();
    if (costItem && pmcGroup) {
      costItemMap.set(costItem.toLowerCase(), pmcGroup);
    }
  }
  console.log(`  ${costItemMap.size} cost-item mappings loaded`);

  // ── Parse the bid CSV ────────────────────────────────────────────────
  console.log('Loading Bid_Distro-Preconstruction (1).csv...');
  const bidRows = parseCSV(bidCsvPath);
  console.log(`  ${bidRows.length} rows`);

  // ── Accumulate hours by (projectName+customer) → pmcGroup → hours ────
  // We walk the rows in order and carry forward the last seen projectName/customer
  let lastProjectName = '';
  let lastCustomer = '';
  let lastStatus = '';

  // Map: `${projectName}||${customer}` → { pmcGroup: hours, ..., _status: string }
  const projectBreakdowns = new Map();

  for (const row of bidRows) {
    // Fill forward projectName / customer / status (same pattern as original import)
    const rawName = (row['projectName'] || '').trim();
    const rawCustomer = (row['customer'] || '').trim();
    const rawStatus = (row['status'] || '').trim();

    if (rawName) lastProjectName = rawName;
    if (rawCustomer) lastCustomer = rawCustomer;
    if (rawStatus) lastStatus = rawStatus;

    const projectName = lastProjectName;
    const customer = lastCustomer;
    if (!projectName || !customer) continue;

    const costItem = (row['Costitems'] || '').trim();
    const hours = parseNum(row['hours']);

    if (!costItem || hours <= 0) continue;

    const pmcGroup = costItemMap.get(costItem.toLowerCase());
    if (!pmcGroup) continue;

    const key = `${projectName.toLowerCase()}||${customer.toLowerCase()}`;
    if (!projectBreakdowns.has(key)) {
      projectBreakdowns.set(key, { _name: projectName, _customer: customer, _status: rawStatus || lastStatus });
    }
    const breakdown = projectBreakdowns.get(key);
    breakdown[pmcGroup] = (breakdown[pmcGroup] || 0) + hours;
  }

  console.log(`  ${projectBreakdowns.size} unique project+customer combos with PMC data`);

  // ── Fetch all DB projects ─────────────────────────────────────────────
  console.log('Fetching projects from DB...');
  const dbProjects = await prisma.project.findMany({
    select: { id: true, projectName: true, customer: true, customFields: true },
  });
  console.log(`  ${dbProjects.length} DB projects`);

  // ── Match and update ──────────────────────────────────────────────────
  let updated = 0;
  let skipped = 0;

  for (const dbP of dbProjects) {
    const key = `${(dbP.projectName || '').toLowerCase().trim()}||${(dbP.customer || '').toLowerCase().trim()}`;
    const breakdown = projectBreakdowns.get(key);
    if (!breakdown) { skipped++; continue; }

    // Build clean breakdown (exclude internal _ fields)
    const pmcGroup = {};
    for (const [k, v] of Object.entries(breakdown)) {
      if (k.startsWith('_')) continue;
      pmcGroup[k] = v;
    }
    if (Object.keys(pmcGroup).length === 0) { skipped++; continue; }

    const existingCf = (dbP.customFields && typeof dbP.customFields === 'object' && !Array.isArray(dbP.customFields))
      ? dbP.customFields
      : {};

    await prisma.project.update({
      where: { id: dbP.id },
      data: {
        customFields: {
          ...existingCf,
          pmcGroup,
          pmcBreakdown: pmcGroup,
          pmcMappingSource: 'Bid_Distro-Preconstruction.csv',
        },
      },
    });

    updated++;
    if (updated % 50 === 0) console.log(`  ...updated ${updated} so far`);
  }

  console.log(`\nDone.`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (no CSV match): ${skipped}`);

  // ── Print pivot breakdown for verification ─────────────────────────────
  console.log('\n--- PMCGroup × Status pivot (from CSV data) ---');
  const pivot = {};
  const allStatuses = new Set();

  for (const [, bd] of projectBreakdowns) {
    const status = (bd._status || 'Unknown').trim();
    allStatuses.add(status);
    for (const [grp, hrs] of Object.entries(bd)) {
      if (grp.startsWith('_')) continue;
      if (!pivot[grp]) pivot[grp] = {};
      pivot[grp][status] = (pivot[grp][status] || 0) + hrs;
    }
  }

  const statuses = Array.from(allStatuses).sort();
  const header = ['PMCGroup', ...statuses, 'Row Total'].join('\t');
  console.log(header);

  const statusTotals = {};
  let grandTotal = 0;

  for (const grp of Object.keys(pivot).sort()) {
    const row = [grp];
    let rowTotal = 0;
    for (const s of statuses) {
      const h = Math.round(pivot[grp][s] || 0);
      row.push(h || '');
      statusTotals[s] = (statusTotals[s] || 0) + h;
      rowTotal += h;
      grandTotal += h;
    }
    row.push(rowTotal);
    console.log(row.join('\t'));
  }

  const totalRow = ['Grand Total', ...statuses.map(s => Math.round(statusTotals[s] || 0)), grandTotal];
  console.log(totalRow.join('\t'));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
