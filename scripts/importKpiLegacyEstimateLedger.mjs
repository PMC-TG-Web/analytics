// Dry run by default. --apply requires the exact old company and reviewed file
// checksum. Inserts immutable snapshots only; never updates or deletes history.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { parseLegacyEstimateLedger, unmigratedLegacySnapshots } from '../src/lib/kpiLegacyEstimateLedger.ts';
import { KPI_CURRENT_COMPANY, KPI_OLD_COMPANY, KPI_WIN_RATE_POLICY_KEY } from '../src/lib/kpiWinRate.ts';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const input = arg('--input');
if (!input) throw new Error('Usage: node scripts/importKpiLegacyEstimateLedger.mjs --input <reviewed-json> [--apply --company <old-company-id> --expect-sha256 <reviewed-file-sha256>]');
const bytes = fs.readFileSync(input);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const ledger = parseLegacyEstimateLedger(JSON.parse(bytes.toString('utf8')));
const apply = args.includes('--apply');
if (apply && (arg('--company') !== KPI_OLD_COMPANY || arg('--expect-sha256') !== sha256)) throw new Error('Apply requires the exact old company and reviewed file checksum.');
const p = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL } } });
try {
  const [current, setting] = await Promise.all([
    p.pmcBidBoardProject.findMany({ where: { companyId: KPI_CURRENT_COMPANY }, select: { companyId: true, bidBoardId: true, projectName: true, status: true, payload: true } }),
    p.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_POLICY_KEY }, select: { value: true } }),
  ]);
  if (!setting) throw new Error('Approved reporting groups are required.');
  const eligible = new Set(unmigratedLegacySnapshots(ledger.records.map(row => row.snapshot), current, JSON.parse(setting.value)).map(row => row.bidBoardId));
  const records = ledger.records.filter(row => eligible.has(row.snapshot.bidBoardId));
  let inserted = 0;
  if (apply) {
    const result = await p.kpiLegacyEstimateSnapshot.createMany({ data: records.map(row => ({
      companyId: KPI_OLD_COMPANY, bidBoardId: row.snapshot.bidBoardId, snapshotHash: row.hash, snapshot: row.snapshot,
    })), skipDuplicates: true });
    inserted = result.count;
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', sha256, sourceCompany: KPI_OLD_COMPANY, records: records.length,
    skippedNowMigrated: ledger.records.length - records.length, withDollars: records.filter(row => row.snapshot.sales !== null).length,
    withHours: records.filter(row => row.snapshot.hours !== null).length, ...(apply ? { inserted, existing: records.length - inserted } : {}) }));
} finally { await p.$disconnect(); }
