import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as domain from '../src/lib/steelNeeds.ts';

const compiled = ts.transpileModule(readFileSync('src/lib/loadSteelNeeds.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = { bidBoardId: 'b1', proposalId: 'e1', estimatedHours: 100, projectManagementHours: 0, allocatableHours: 100 };
const project = { key: 'p1', projectId: 'p1', projectName: 'Test job', projectNumber: '', customer: '', projectManager: '', source, issue: null, plan: null };

test('loader reads every selected-estimate page, scopes company and IDs, and never substitutes partial activity on failure', async () => {
  let pageCalls = 0, activityCalls = 0, failActivity = false;
  const mocks = {
    '@/lib/loadWipPlanning': { wipCompanyId: () => 'company', loadWipPlanning: async force => { assert.equal(force, true); return [project]; } },
    '@/lib/wipLocalStore': { wipLocalStorePath: () => null },
    '@/lib/steelNeeds': domain,
    '@/lib/prisma': { prisma: {
      steelOrderMark: { findMany: async query => {
        assert.equal(query.where.companyId, 'company'); assert.deepEqual(query.where.projectId.in, ['p1']);
        return [{ projectId: 'p1', itemKey: JSON.stringify(["#4 rebar - 20' pc", 'EA']), revision: 1, orderedAt: new Date('2026-11-10T12:00:00Z'), quantity: 1002 }];
      } },
      procoreEstimateLineItem: { findMany: async query => {
        assert.equal(query.where.companyId, 'company'); assert.deepEqual(query.where.OR, [{ bidBoardProjectId: 'b1', proposalId: 'e1' }]);
        assert.deepEqual(query.orderBy, { id: 'asc' }); assert.equal(query.take, 500);
        const start = Number(query.where.id?.gt || 0n);
        pageCalls++;
        return Array.from({ length: start ? 1 : 500 }, (_, index) => ({
          id: BigInt(start + index + 1), companyId: 'company', bidBoardProjectId: 'b1', proposalId: 'e1', lineItemId: String(start + index + 1),
          name: '#4 Rebar', uom: 'ea', quantity: { toString: () => '2' }, payload: {}, syncedAt: new Date('2026-11-10T12:00:00Z'),
        }));
      } },
      $queryRaw: async (parts, ...values) => {
        activityCalls++;
        assert.deepEqual(values, ['company', 'company']);
        const sql = parts.join('?');
        assert.equal((sql.match(/SELECT DISTINCT ON/g) || []).length, 2);
        assert.match(sql, /COALESCE\("procoreUpdatedAt", "updatedAt"\) DESC/);
        assert.match(sql, /FROM logs\s+WHERE "procoreDeletedAt" IS NULL/);
        assert.match(sql, /FROM timecards\s+WHERE "procoreDeletedAt" IS NULL/);
        assert.match(sql, /NOT ILIKE '%Billing File%'/);
        assert.doesNotMatch(sql, /quantityUsed|hours >|status = 'approved'/);
        if (failActivity) throw Error('Activity unavailable');
        return [{ projectId: 'p1', dailyLogs: 0, timesheets: 1, firstActivity: '2026-10-01' }];
      },
    } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks); return mocks[id]; }, module, module.exports);
  const result = await module.exports.loadSteelNeeds();
  assert.equal(pageCalls, 2); assert.equal(activityCalls, 1); assert.equal(result.projects[0].items[0].quantity, 1002);
  assert.equal(result.projects[0].started, true); assert.equal(result.localOnly, false);
  assert.equal(result.projects[0].items[0].order.orderedAt, '2026-11-10T12:00:00.000Z');
  failActivity = true;
  await assert.rejects(module.exports.loadSteelNeeds(), /Activity unavailable/);
});
