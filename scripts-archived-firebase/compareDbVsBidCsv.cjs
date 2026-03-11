/**
 * compareDbVsBidCsv.cjs
 * Compare DB project rows vs Bid_Distro-Preconstruction (1).csv
 * using normalized keys and focused Sadsbury breakdown.
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

function key(projectName, customer, status) {
  return `${norm(projectName)}||${norm(customer)}||${norm(status)}`;
}

function parseHours(v) {
  if (!v) return 0;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const csvPath = path.join(__dirname, '..', 'Bid_Distro-Preconstruction (1).csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found at', csvPath);
    process.exit(1);
  }

  const csvRowsRaw = parseCsv(csvPath);

  // Fill-forward for blank project/customer/status cells
  let lastProjectName = '';
  let lastCustomer = '';
  let lastStatus = '';

  const csvGrouped = new Map(); // key -> {projectName,customer,status,hours,lineCount}
  for (const r of csvRowsRaw) {
    const pn = r.projectName?.trim();
    const cust = r.customer?.trim();
    const st = r.status?.trim();
    if (pn) lastProjectName = pn;
    if (cust) lastCustomer = cust;
    if (st) lastStatus = st;

    if (!lastProjectName || !lastCustomer || !lastStatus) continue;

    const hours = parseHours(r.hours);
    const k = key(lastProjectName, lastCustomer, lastStatus);
    if (!csvGrouped.has(k)) {
      csvGrouped.set(k, {
        projectName: lastProjectName,
        customer: lastCustomer,
        status: lastStatus,
        hours: 0,
        lineCount: 0,
      });
    }
    const rec = csvGrouped.get(k);
    rec.hours += hours;
    rec.lineCount += 1;
  }

  const dbRows = await prisma.project.findMany({
    select: { projectName: true, customer: true, status: true, hours: true, projectArchived: true },
  });

  const activeDbRows = dbRows.filter(r => !r.projectArchived);

  const dbGrouped = new Map(); // active-only key -> {projectName,customer,status,hours,rowCount,archivedCount}
  for (const r of activeDbRows) {
    const pn = r.projectName || '';
    const cust = r.customer || '';
    const st = r.status || '';
    const k = key(pn, cust, st);
    if (!dbGrouped.has(k)) {
      dbGrouped.set(k, {
        projectName: pn,
        customer: cust,
        status: st,
        hours: 0,
        rowCount: 0,
        archivedCount: 0,
      });
    }
    const rec = dbGrouped.get(k);
    rec.hours += Number(r.hours) || 0;
    rec.rowCount += 1;
    if (r.projectArchived) rec.archivedCount += 1;
  }

  const csvKeys = new Set(csvGrouped.keys());
  const dbKeys = new Set(dbGrouped.keys());

  const inCsvNotDb = [...csvKeys].filter(k => !dbKeys.has(k));
  const inDbNotCsv = [...dbKeys].filter(k => !csvKeys.has(k));

  console.log('--- Totals (grouped by projectName+customer+status) ---');
  console.log(`CSV groups: ${csvGrouped.size}`);
  console.log(`DB groups (active only):  ${dbGrouped.size}`);
  console.log(`In CSV not DB: ${inCsvNotDb.length}`);
  console.log(`In DB not CSV: ${inDbNotCsv.length}`);

  // Focus: Sadsbury Commons
  console.log('\n--- Sadsbury Commons in CSV ---');
  const sCsv = [...csvGrouped.values()].filter(v => norm(v.projectName) === 'sadsbury commons');
  if (!sCsv.length) console.log('None');
  sCsv.forEach(v => {
    console.log(`CSV | customer=${v.customer} | status=${v.status} | hours=${Math.round(v.hours)} | lines=${v.lineCount}`);
  });

  console.log('\n--- Sadsbury Commons in DB ---');
  const sDb = [...dbGrouped.values()].filter(v => norm(v.projectName) === 'sadsbury commons');
  if (!sDb.length) console.log('None');
  sDb.forEach(v => {
    console.log(`DB  | customer=${v.customer} | status=${v.status} | hours=${Math.round(v.hours)} | rows=${v.rowCount} | archivedRows=${v.archivedCount}`);
  });

  console.log('\n--- Sadsbury key comparison ---');
  const sCsvKeys = new Set(sCsv.map(v => key(v.projectName, v.customer, v.status)));
  const sDbKeys = new Set(sDb.map(v => key(v.projectName, v.customer, v.status)));

  const sCsvNotDb = [...sCsvKeys].filter(k => !sDbKeys.has(k));
  const sDbNotCsv = [...sDbKeys].filter(k => !sCsvKeys.has(k));

  console.log(`Sadsbury keys in CSV not DB: ${sCsvNotDb.length}`);
  sCsvNotDb.forEach(k => {
    const v = sCsv.find(x => key(x.projectName, x.customer, x.status) === k);
    console.log(`  CSV-only: ${v.customer} | ${v.status} | ${Math.round(v.hours)} hrs`);
  });

  console.log(`Sadsbury keys in DB not CSV: ${sDbNotCsv.length}`);
  sDbNotCsv.forEach(k => {
    const v = sDb.find(x => key(x.projectName, x.customer, x.status) === k);
    console.log(`  DB-only: ${v.customer} | ${v.status} | ${Math.round(v.hours)} hrs`);
  });

  // Quick hour comparison for matched keys (top diffs)
  const diffs = [];
  for (const k of csvKeys) {
    if (!dbGrouped.has(k)) continue;
    const c = csvGrouped.get(k);
    const d = dbGrouped.get(k);
    const delta = (d.hours || 0) - (c.hours || 0);
    if (Math.abs(delta) > 0.5) {
      diffs.push({
        projectName: c.projectName,
        customer: c.customer,
        status: c.status,
        csvHours: c.hours,
        dbHours: d.hours,
        delta,
      });
    }
  }

  diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log('\n--- Top 15 matched-key hour deltas (DB - CSV) ---');
  diffs.slice(0, 15).forEach(x => {
    console.log(`${x.projectName} | ${x.customer} | ${x.status} | CSV=${Math.round(x.csvHours)} DB=${Math.round(x.dbHours)} Δ=${Math.round(x.delta)}`);
  });
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
