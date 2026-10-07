// Dry run by default. --apply saves old-instance history once and retires its
// exact header queue entry. No Procore calls, deletes, or snapshot overwrites.
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { calculateWinRate, combineWinRateSources, createWinRateBaseline, parseWinRateBaseline, KPI_CURRENT_COMPANY, KPI_OLD_COMPANY, KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY } from '../src/lib/kpiWinRate.ts';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const apply = process.argv.includes('--apply');
const p = new PrismaClient();
try {
  const [existing, policyRecord, rows] = await Promise.all([
    p.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_BASELINE_KEY } }),
    p.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_POLICY_KEY } }),
    p.pmcBidBoardProject.findMany({ where: { companyId: { in: [KPI_CURRENT_COMPANY, KPI_OLD_COMPANY] } } }),
  ]);
  if (!policyRecord) throw new Error('Approved project grouping must be saved first.');
  const policy = JSON.parse(policyRecord.value);
  let baseline = existing ? parseWinRateBaseline(existing.value) : createWinRateBaseline(rows);
  const combined = combineWinRateSources(rows, baseline);
  if (!existing) {
    for (const year of [null, ...calculateWinRate(rows, policy).years]) {
      const before = calculateWinRate(rows, policy, year);
      const after = calculateWinRate(combined, policy, year);
      assert.deepEqual(after.total, before.total);
      assert.deepEqual(after.months, before.months);
      assert.deepEqual(after.projects, before.projects);
    }
  }
  if (apply) {
    const record = await p.$transaction(async tx => {
      const saved = await tx.estimatingConstant.upsert({
        where: { name: KPI_WIN_RATE_BASELINE_KEY },
        create: { name: KPI_WIN_RATE_BASELINE_KEY, category: 'KPI_REPORTING', value: JSON.stringify(baseline) },
        update: {}, // Never replace saved history, including on concurrent runs.
      });
      await tx.procoreSyncProjectState.updateMany({
        where: { companyId: KPI_CURRENT_COMPANY, projectId: '__old_company_bid_board__', dataset: 'nightly_bid_board_headers' },
        data: { nextRunAt: new Date('9999-01-01T00:00:00Z') },
      });
      return saved;
    }, { timeout: 15000 });
    baseline = parseWinRateBaseline(record.value);
  }
  console.log(JSON.stringify({ mode: apply ? 'saved' : 'dry-run', reusedExisting: Boolean(existing), savedAt: baseline.savedAt, sourceBids: baseline.bids.length, total: calculateWinRate(combineWinRateSources(rows, baseline), policy).total }));
} finally { await p.$disconnect(); }
