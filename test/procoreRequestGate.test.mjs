import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import * as connection from '../src/lib/procoreConnection.ts';
import * as budget from '../src/lib/procoreRequestBudget.ts';
import * as rateLimits from '../src/lib/procoreRateLimit.ts';

function fixture({ delay = 3_200, failInitialization = false } = {}) {
  let now = Date.now();
  let row = { lease_id: null, lease_until: null, interactive_until: null, blocked_until: null, windows: [] };
  let transactionCount = 0;
  let usage = 0;
  const prisma = {
    async $executeRaw() {
      if (failInitialization) throw new Error('Database unavailable');
      // Slow initialization must not consume the lock transaction's lifetime.
      now += 6_284;
      return 1;
    },
    async $transaction(operation, options) {
      transactionCount += 1;
      const started = now;
      const saved = structuredClone(row);
      const savedUsage = usage;
      const advance = () => {
        now += delay;
        if (now - started > (options?.timeout ?? 5_000)) throw new Error('Transaction expired');
      };
      try {
        return await operation({
          async $queryRaw() { advance(); return [{ ...row, now: new Date(now) }]; },
          async $executeRaw(strings, ...values) {
            advance();
            const sql = strings.join('?');
            if (sql.includes('INSERT INTO')) usage += 1;
            else if (sql.includes('lease_id = NULL')) {
              row = { ...row, lease_id: null, lease_until: null, windows: JSON.parse(values[1]), blocked_until: values[2] };
            } else if (sql.includes('lease_id =')) {
              row = { ...row, lease_id: values[1], lease_until: values[2], interactive_until: values[3], windows: JSON.parse(values[4]) };
            } else row = { ...row, interactive_until: values[1] };
            return 1;
          },
        });
      } catch (error) { row = saved; usage = savedUsage; throw error; }
    },
  };
  const dependencies = {
    '@prisma/client': { Prisma }, 'node:crypto': { randomUUID }, '@/lib/prisma': { prisma },
    '@/lib/procoreConnection': connection, '@/lib/procoreRequestBudget': budget, '@/lib/procoreRateLimit': rateLimits,
  };
  const mod = { exports: {} };
  const js = ts.transpileModule(readFileSync('src/lib/procoreRequestGate.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', 'fetch', js)(id => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, mod, mod.exports, () => assert.fail('Gate transactions must not call Procore'));
  return { gate: mod.exports, state: () => ({ row, transactionCount, usage }) };
}

test('slow database round trips do not expire permit acquisition or completion at five seconds', async () => {
  const f = fixture();
  const first = await f.gate.acquireProcoreRequestPermit('company', 'background');
  assert.ok(first.permit);
  const waiting = await f.gate.acquireProcoreRequestPermit('company', 'background');
  assert.equal(waiting.permit, null, 'Slower transactions must still respect the active lease');
  await f.gate.completeProcoreRequestPermit({ permit: first.permit, observation: null, method: 'GET', path: '/project_roles', status: 200 });
  assert.equal(f.state().row.lease_id, null);
  assert.equal(f.state().usage, 1);
  const next = await f.gate.acquireProcoreRequestPermit('company', 'background');
  assert.ok(next.permit);
  await f.gate.completeProcoreRequestPermit({ permit: first.permit, observation: null, method: 'GET', path: '/project_roles', status: 200 });
  assert.equal(f.state().row.lease_id, next.permit.leaseId, 'Late completion cannot release a newer owner');
  assert.equal(f.state().usage, 1, 'Late completion cannot double-count usage');
});

test('initialization failures never grant a permit or enter the reservation transaction', async () => {
  const f = fixture({ failInitialization: true });
  await assert.rejects(f.gate.acquireProcoreRequestPermit('company', 'background'), /Database unavailable/);
  assert.equal(f.state().transactionCount, 0);
  assert.equal(f.state().row.lease_id, null);
});

test('extreme database delays remain bounded and cannot leave a granted lease', async () => {
  const f = fixture({ delay: 8_000 });
  await assert.rejects(f.gate.acquireProcoreRequestPermit('company', 'background'), /Transaction expired/);
  assert.equal(f.state().row.lease_id, null);
});
