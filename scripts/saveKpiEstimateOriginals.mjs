// Dry run by default. Saves only explicitly confirmed company/bid/proposal IDs;
// does not modify Procore or its mirrors, and never replaces prior confirmations.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { KPI_ESTIMATE_ORIGINALS_KEY, parseConfirmedEstimateOriginals, mergeConfirmedEstimateOriginals } from '../src/lib/kpiEstimateOriginals.ts';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const input = arg('--input');
if (!input) throw new Error('Usage: node scripts/saveKpiEstimateOriginals.mjs --input <confirmed-json> [--apply --company <company-id> --expect-sha256 <file-checksum>]');
const bytes = fs.readFileSync(input);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const incoming = parseConfirmedEstimateOriginals(bytes.toString('utf8').replace(/^\uFEFF/, ''));
if (!incoming.originals.length) throw new Error('No original estimates were supplied.');
const apply = args.includes('--apply');
if (apply && (arg('--expect-sha256') !== sha256 || incoming.originals.some(row => row.companyId !== arg('--company')))) {
  throw new Error('Apply requires the exact company and confirmed file checksum.');
}
const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL } } });
try {
  const result = await db.$transaction(async tx => {
    for (const row of incoming.originals) {
      const source = await tx.procoreEstimateProposal.findFirst({
        where: { companyId: row.companyId, bidBoardProjectId: row.bidBoardId, proposalId: row.proposalId }, select: { payload: true },
      });
      if (source?.payload?.type !== 'ESTIMATE' || source.payload.is_procore_bid_form_alternate === true) {
        throw new Error(`Confirmed proposal is not a saved non-alternate estimate: ${row.companyId}:${row.bidBoardId}:${row.proposalId}`);
      }
    }
    const where = { name: KPI_ESTIMATE_ORIGINALS_KEY };
    const existing = await tx.estimatingConstant.findUnique({ where });
    const merged = mergeConfirmedEstimateOriginals(parseConfirmedEstimateOriginals(existing?.value ?? null), incoming);
    const value = JSON.stringify(merged);
    if (apply) {
      // Upsert creates the setting if absent. A concurrent create/update must
      // never be overwritten with a merge based on older policy.
      const saved = existing ?? await tx.estimatingConstant.upsert({ where,
        create: { ...where, category: 'KPI_REPORTING', value }, update: {},
      });
      if (!existing && saved.value !== value) throw new Error('Confirmations changed during save; rerun to merge the current policy.');
      if (existing) {
        const updated = await tx.estimatingConstant.updateMany({ where: { ...where, value: existing.value }, data: { value } });
        if (updated.count !== 1) throw new Error('Confirmations changed during save; rerun to merge the current policy.');
      }
    }
    return { requested: incoming.originals.length, total: merged.originals.length,
      added: merged.originals.length - (existing ? parseConfirmedEstimateOriginals(existing.value).originals.length : 0) };
  }, { timeout: 15000 });
  console.log(JSON.stringify({ mode: apply ? 'saved' : 'dry-run', sha256, ...result }));
} finally { await db.$disconnect(); }
