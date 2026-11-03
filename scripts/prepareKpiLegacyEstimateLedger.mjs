// Read-only: prepares a review file from retained old-instance Bid Board headers.
// No Procore calls, database writes, or changes to the frozen win-rate baseline.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { buildLegacyEstimateLedger, parseLegacyEstimateLedger } from '../src/lib/kpiLegacyEstimateLedger.ts';
import { KPI_CURRENT_COMPANY, KPI_OLD_COMPANY, KPI_WIN_RATE_POLICY_KEY } from '../src/lib/kpiWinRate.ts';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const output = arg('--out');
if (!output || args.includes('--apply')) throw new Error('Usage: node scripts/prepareKpiLegacyEstimateLedger.mjs --out <new-json-file> [--estimates <reviewed-json-file>]');
const file = path.resolve(output);
if (fs.existsSync(file)) throw new Error('Output already exists. Preserve it and choose a new review file.');
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL } } });
try {
  const [rows, setting] = await Promise.all([
    p.pmcBidBoardProject.findMany({ where: { companyId: { in: [KPI_OLD_COMPANY, KPI_CURRENT_COMPANY] } }, select: { companyId: true, bidBoardId: true, projectName: true, customer: true, status: true, payload: true, syncedAt: true } }),
    p.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_POLICY_KEY }, select: { value: true } }),
  ]);
  if (!setting) throw new Error('Approved reporting groups are required.');
  const evidence = arg('--estimates') ? JSON.parse(fs.readFileSync(arg('--estimates'), 'utf8')) : [];
  if (!Array.isArray(evidence)) throw new Error('Estimate evidence must be an array of exact old-instance IDs and full estimate values.');
  const ledger = parseLegacyEstimateLedger(buildLegacyEstimateLedger(rows, rows, JSON.parse(setting.value), evidence));
  if (!ledger.records.length) throw new Error('No unmigrated old-instance bids were found.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ mode: 'local-review-file', file, records: ledger.records.length, skippedMigrated: ledger.skippedMigrated,
    withDollars: ledger.records.filter(row => row.snapshot.sales !== null).length, withHours: ledger.records.filter(row => row.snapshot.hours !== null).length }));
} finally { await p.$disconnect(); }
