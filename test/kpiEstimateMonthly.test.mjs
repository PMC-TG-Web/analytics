import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePublishedEstimateMonth, totalEstimateAmounts } from '../src/lib/kpiEstimateMonthly.ts';
import { resolvePermissionForPath } from '../src/lib/permissions.ts';

const report = { months: { '2026-10': { sales: 125000, hours: 1300, missingSales: 0, missingHours: 0 },
  '2026-11': { sales: -5000, hours: -100, missingSales: 0, missingHours: 1 } } };

test('October release preserves saved earlier values including zero, without requiring the new report', () => {
  for (const metric of ['sales', 'hours']) {
    assert.deepEqual(resolvePublishedEstimateMonth('2026', 9, metric, 0, null, 'offline'), { value: 0, missing: 0, calculated: false, pending: false, failed: false });
    assert.equal(resolvePublishedEstimateMonth('2026', 1, metric, 812182, report).value, 812182);
  }
});

test('new process ignores manual overrides for both dollars and full hours and retains reductions', () => {
  assert.equal(resolvePublishedEstimateMonth('2026', 10, 'sales', 999999, report).value, 125000);
  assert.equal(resolvePublishedEstimateMonth('2026', 10, 'hours', 22, report).value, 1300);
  assert.equal(resolvePublishedEstimateMonth('2026', 11, 'sales', 999999, report).value, -5000);
  assert.equal(resolvePublishedEstimateMonth('2026', 11, 'hours', 22, report).missing, 1);
  assert.equal(resolvePublishedEstimateMonth('2027', 1, 'hours', 22, report).value, 0);
});

test('combined yearly amounts include saved history once plus new contributions and propagate gaps', () => {
  const values = [resolvePublishedEstimateMonth('2026', 9, 'hours', 3000, report), resolvePublishedEstimateMonth('2026', 10, 'hours', 99999, report), resolvePublishedEstimateMonth('2026', 11, 'hours', 99999, report)];
  assert.deepEqual(totalEstimateAmounts(values), { value: 4200, missing: 1, calculated: true, pending: false, failed: false });
});

test('loading and failed refresh cannot substitute manual or stale calculated amounts', () => {
  const pending = resolvePublishedEstimateMonth('2026', 10, 'sales', 999999, null);
  const failed = resolvePublishedEstimateMonth('2026', 10, 'sales', 999999, report, 'offline');
  assert.equal(pending.pending, true);
  assert.equal(failed.failed, true);
  assert.equal(failed.value, 0);
  assert.equal(totalEstimateAmounts([resolvePublishedEstimateMonth('2026', 9, 'sales', 200, report), failed]).failed, true);
});

test('published estimates endpoint remains KPI protected, no-store, database-only and excludes local evidence', () => {
  assert.equal(resolvePermissionForPath('/api/kpi/estimates'), 'kpi');
  const route = readFileSync(new URL('../src/app/api/kpi/estimates/route.ts', import.meta.url), 'utf8');
  assert.match(route, /getRequestUserEmail\(request\)/);
  assert.match(route, /hasDatabasePageAccess\(prisma, actor, 'kpi'\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /includeLegacy: false/);
  assert.doesNotMatch(route, /NODE_ENV|makeRequest|fetch\(|export async function (POST|PUT|PATCH|DELETE)/);
});
