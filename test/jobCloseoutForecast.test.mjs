import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyForecastPlan, forecastPlan } from '../scripts/lib/jobCloseoutForecast.mjs';
import { changeCloseout } from '../src/lib/jobCloseoutStore.mjs';
import {
  canApproveCloseoutForecast,
  CLOSEOUT_ZERO_FORECAST_PERMISSION,
  hasAccessAdministratorRole,
  expandAssignedPermissions,
} from '../src/lib/permissions.ts';

const scope = { companyId: '10', projectId: '20', viewId: '30' };
const row = (id, amount) => ({
  company_id: 10,
  project_id: 20,
  budgeted: true,
  id,
  wbs_code_id: id + 100,
  budget_forecast: { amount, manual_amount: '0', calculation_strategy: 'automatic' },
});
const initial = [row(1, '34.01'), row(2, '-2.15'), row(3, '0'), { ...row(4, '18'), id: null, budgeted: false }];
const preview = (rows) => forecastPlan(scope.companyId, scope.projectId, scope.viewId, rows);
const approved = preview(initial);
const reviewed = async () => {};
test('preview separates budgeted and partial rows, excludes zero and checks scope', () => {
  assert.deepEqual(
    approved.editable.map((r) => r.amount),
    [3401, -215],
  );
  assert.deepEqual(
    approved.partial.map((r) => r.amount),
    [1800],
  );
  assert.throws(() => preview([{ ...initial[0], project_id: 1 }]), /another project/);
  assert.throws(() => preview([initial[0], initial[0]]), /duplicated/);
});
test('zeroing uses reviewed identities, skips already-zero rows and verifies the selected method', async () => {
  let live = structuredClone(initial);
  live[1].budget_forecast.amount = '0';
  let calls = 0;
  const apply = () =>
    applyForecastPlan(
      approved,
      scope,
      async () => live,
      async (rows) => {
        calls++;
        assert.deepEqual(rows, [{ budget_line_item_id: '1', wbs_code_id: '101', forecast_to_complete: 0 }]);
        live[0].budget_forecast = { amount: '0', manual_amount: '0', calculation_strategy: 'lump sum' };
      },
      reviewed,
    );
  assert.deepEqual(await apply(), { manualZeros: 1, alreadyZero: 1 });
  assert.deepEqual(await apply(), { manualZeros: 1, alreadyZero: 1 });
  assert.equal(calls, 1);
});
test('changed scope, amount, method, row identity or claim stops before write', async () => {
  const never = () => assert.fail('unexpected forecast write');
  await assert.rejects(
    applyForecastPlan(approved, { ...scope, viewId: '31' }, never, never, reviewed),
    /scope changed/,
  );
  for (const alter of [
    (rows) => {
      rows[0].wbs_code_id += 1000;
    },
    (rows) => {
      rows[1].budget_forecast.amount = '8';
    },
    (rows) => {
      rows[1].budget_forecast.calculation_strategy = 'itemized';
    },
    (rows) => {
      rows.shift();
    },
  ]) {
    const rows = structuredClone(initial);
    alter(rows);
    await assert.rejects(
      applyForecastPlan(approved, scope, async () => rows, never, reviewed),
      /changed/,
    );
  }
  await assert.rejects(
    applyForecastPlan(
      approved,
      scope,
      async () => initial,
      never,
      () => {
        throw Error('claim lost');
      },
    ),
    /claim lost/,
  );
  await assert.rejects(
    applyForecastPlan(
      approved,
      scope,
      async () => initial,
      async () => {},
      reviewed,
    ),
    /not verified/,
  );
});
test('approval queues the saved revision, never client-supplied amounts, and cannot supersede an active write', async () => {
  let current = {
    id: 'report1',
    state: 'ready',
    cycle: 1,
    revision: 1,
    folder: 'GC/Job',
    report: { forecasts: approved },
  };
  const tx = {
    $queryRaw: async () => [{ id: 'r', completion_count: 1 }],
    jobCloseoutRun: {
      findFirst: async () => current,
      create: async ({ data }) => {
        current = { ...data, id: 'queued2', state: 'queued' };
      },
    },
  };
  const db = { $transaction: (fn) => fn(tx) };
  const send = (fields) =>
    changeCloseout(db, '10', 'reviewer', {
      action: 'zeroForecast',
      projectId: '20',
      cycle: 1,
      runId: 'report1',
      ...fields,
    });
  assert.equal(await send({ runId: 'older' }), false);
  assert.equal(await send({ editable: [{ amount: 999999 }] }), true);
  assert.deepEqual(current.report, { forecastSourceRunId: 'report1' });
  assert.equal(current.requestedBy, 'reviewer');
  assert.equal(await send({}), true);
  assert.equal(await send({ action: 'refresh', runId: 'queued2' }), false);
});
test('the forecast action grant enables approval without granting page or administrator access', () => {
  for (const role of ['OWNER', 'ADMIN', CLOSEOUT_ZERO_FORECAST_PERMISSION])
    assert.equal(canApproveCloseoutForecast([role]), true);
  for (const other of [[], ['admin'], ['page:/accounting/job-closeout'], ['job-closeout']])
    assert.equal(canApproveCloseoutForecast(other), false);
  assert.equal(hasAccessAdministratorRole([CLOSEOUT_ZERO_FORECAST_PERMISSION]), false);
  assert.equal(
    expandAssignedPermissions([CLOSEOUT_ZERO_FORECAST_PERMISSION]).includes('page:/accounting/job-closeout'),
    false,
  );
});
test('the closeout API checks active page access and uses the same action grant for display and submission', () => {
  const route = readFileSync(new URL('../src/app/api/accounting/job-closeout/route.ts', import.meta.url), 'utf8');
  assert.match(route, /hasDatabasePageAccess\(prisma, actor, 'page:\/accounting\/job-closeout'\)/);
  assert.match(
    route,
    /input\.action === 'zeroForecast'\s*&&\s*!canApproveCloseoutForecast\(await loadUserAssignedPermissionsFromDatabase\(prisma, actor\)\)/,
  );
  assert.match(
    route,
    /project && canApproveCloseoutForecast\(await loadUserAssignedPermissionsFromDatabase\(prisma, actor\)\)/,
  );
});
