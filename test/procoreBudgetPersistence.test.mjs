import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const initialTime = new Date('2026-10-26T18:00:00.000Z');
const line = (id, projectId = 'project-a', amount = 100) => ({
  projectId, budgetLineItemId: id, amount, quantity: 5, costCode: '03-300.L', payload: { id, note: 'retained source evidence' },
});
const key = (company, project, id) => `${company}/${project}/${id}`;

function fixture({ fail, supersededAtDatabasePrecision = false } = {}) {
  const state = { rows: new Map(), snapshots: new Map(), clock: initialTime.getTime(), transactions: 0, commits: 0, rollbacks: 0, calls: [] };
  const nextTime = () => new Date(++state.clock);
  const prisma = {
    $queryRawUnsafe: async sql => {
      assert.equal(sql, 'SELECT clock_timestamp() AS started_at');
      return [{ started_at: new Date(state.clock) }];
    },
    $transaction: async (operation, options) => {
      assert.ok(options.timeout > 0 && options.timeout <= 15_000, "Production Accelerate rejects larger transaction timeouts");
      state.transactions++;
      const rows = structuredClone(state.rows), snapshots = structuredClone(state.snapshots);
      const tx = {
        $queryRawUnsafe: async (sql, company, project, startedAt) => {
          assert.match(sql, /MAX\(GREATEST\(synced_at, updated_at\)\)/);
          assert.match(sql, /last_write_at > \$3::timestamptz/);
          assert.match(sql, /MAX\(GREATEST\(synced_at, updated_at\)\) > \$3::timestamptz/);
          assert.match(sql, /WHERE company_id = \$1 AND project_id = \$2/);
          state.calls.push({ kind: 'inspect', company, project });
          const selected = [...rows.values()].filter(r => r.company_id === company && r.project_id === project);
          const latest = Math.max(0, ...selected.flatMap(r => [r.synced_at?.getTime() || 0, r.updated_at?.getTime() || 0]));
          return [{ superseded: supersededAtDatabasePrecision || latest > startedAt.getTime()
              || (snapshots.get(key(company, project, 'state'))?.last_write_at?.getTime() || 0) > startedAt.getTime(),
            active_count: selected.filter(r => !r.source_missing_at).length }];
        },
        $executeRawUnsafe: async (sql, ...values) => {
          if (sql.includes('pg_advisory_xact_lock')) {
            assert.match(sql, /hashtextextended\(\$1, 0\)/);
            state.calls.push({ kind: 'lock', scope: values[0] });
            return 1;
          }
          if (sql.includes('INSERT INTO budgetlineitems')) {
            state.calls.push({ kind: 'upsert' });
            assert.match(sql, /ON CONFLICT \(company_id, project_id, budget_line_item_id\)/);
            assert.match(sql, /source_missing_at = NULL/);
            if (fail === 'upsert') throw new Error('Injected upsert failure');
            const records = JSON.parse(values[0]);
            for (const row of records) rows.set(key(row.company_id, row.project_id, row.budget_line_item_id), {
              ...rows.get(key(row.company_id, row.project_id, row.budget_line_item_id)), ...row,
              source_missing_at: null, synced_at: nextTime(), updated_at: nextTime(),
            });
            return records.length;
          }
          if (sql.includes('UPDATE budgetlineitems')) {
            state.calls.push({ kind: 'missing' });
            assert.match(sql, /WHERE company_id = \$1 AND project_id = \$2/);
            assert.match(sql, /source_missing_at IS NULL/);
            assert.match(sql, /NOT \(budget_line_item_id = ANY\(\$3::text\[\]\)\)/);
            assert.doesNotMatch(sql, /DELETE|payload\s*=/i);
            const [company, project, present] = values;
            let count = 0;
            for (const row of rows.values()) {
              if (row.company_id !== company || row.project_id !== project || row.source_missing_at || present.includes(row.budget_line_item_id)) continue;
              row.source_missing_at = nextTime(); row.synced_at = nextTime(); row.updated_at = nextTime(); count++;
            }
            if (fail === 'missing') throw new Error('Injected missing-marker failure');
            return count;
          }
          assert.match(sql, /INSERT INTO procore_budget_snapshot_states/);
          state.calls.push({ kind: 'state' });
          if (fail === 'state') throw new Error('Injected state failure');
          const [company, project, startedAt, complete, count] = values;
          const previous = snapshots.get(key(company, project, 'state')) || {};
          snapshots.set(key(company, project, 'state'), {
            last_write_at: nextTime(), last_snapshot_started_at: startedAt,
            last_complete_at: complete ? nextTime() : previous.last_complete_at || null,
            source_count: complete ? count : previous.source_count ?? null,
          });
          return 1;
        },
      };
      try {
        const result = await operation(tx);
        state.rows = rows; state.snapshots = snapshots; state.commits++;
        return result;
      } catch (error) { state.rollbacks++; throw error; }
    },
    $executeRawUnsafe: async () => assert.fail('Snapshot writes must stay inside the project transaction'),
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync('src/lib/procoreBudgetLineItems.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(id => {
    assert.equal(id, '@/lib/prisma');
    return { prisma };
  }, module, module.exports);
  function existing(company, project, id, options = {}) {
    state.rows.set(key(company, project, id), { company_id: company, project_id: project, budget_line_item_id: id,
      amount: 200, payload: { id, evidence: 'unchanged' }, unpacked: 'retained',
      synced_at: new Date(initialTime.getTime() - 1000), updated_at: new Date(initialTime.getTime() - 1000),
      source_missing_at: null, ...options });
  }
  async function persist(items, options = {}) {
    return module.exports.persistBudgetSnapshot({ companyId: 'company-a', projectId: 'project-a', items,
      startedAt: await module.exports.startBudgetSnapshot(), complete: true, reconcileAbsent: true, ...options });
  }
  return { state, existing, persist, api: module.exports };
}

test('complete authoritative budget snapshot changes only its exact company/project and retains absent evidence', async () => {
  const f = fixture();
  f.existing('company-a', 'project-a', 'present');
  f.existing('company-a', 'project-a', 'gone');
  f.existing('company-b', 'project-a', 'gone');
  f.existing('company-a', 'project-b', 'gone');
  const result = await f.persist([line('present')]);
  assert.deepEqual(result, { upserted: 1, missing: 1, reconciled: true, complete: true });
  const gone = f.state.rows.get('company-a/project-a/gone');
  assert.ok(gone.source_missing_at instanceof Date);
  assert.deepEqual(gone.payload, { id: 'gone', evidence: 'unchanged' });
  assert.equal(gone.unpacked, 'retained');
  assert.equal(f.state.rows.get('company-b/project-a/gone').source_missing_at, null);
  assert.equal(f.state.rows.get('company-a/project-b/gone').source_missing_at, null);
  assert.deepEqual(f.state.calls.map(c => c.kind), ['lock', 'inspect', 'upsert', 'missing', 'state']);
  assert.equal(f.state.calls[0].scope, 'budget:company-a:project-a');
});

test('present source rows restore prior missing markers, and repeated snapshots do not count old absences again', async () => {
  const f = fixture();
  f.existing('company-a', 'project-a', 'restored', { source_missing_at: new Date('2026-10-20') });
  f.existing('company-a', 'project-a', 'still-gone', { source_missing_at: new Date('2026-10-20') });
  const result = await f.persist([line('restored')]);
  assert.equal(result.missing, 0);
  assert.equal(f.state.rows.get('company-a/project-a/restored').source_missing_at, null);
  assert.ok(f.state.rows.get('company-a/project-a/still-gone').source_missing_at);
});

test('complete interactive and partial imports never infer absence', async () => {
  for (const complete of [false, true]) {
    const f = fixture();
    f.existing('company-a', 'project-a', 'unseen');
    const result = await f.persist([line('present')], { complete, reconcileAbsent: false });
    assert.deepEqual(result, { upserted: 1, missing: 0, reconciled: false, complete });
    assert.equal(f.state.rows.get('company-a/project-a/unseen').source_missing_at, null);
    assert.ok(!f.state.calls.some(c => c.kind === 'missing'));
    assert.equal(f.state.snapshots.get('company-a/project-a/state').last_complete_at, null);
  }
});

test('an incomplete reconciliation, duplicate IDs and foreign-project rows fail before any transaction', async () => {
  for (const [items, options, message] of [
    [[line('one')], { complete: false }, /incomplete/],
    [[line('same'), line('same')], {}, /duplicate/],
    [[line('same'), line(' same ')], {}, /duplicate/],
    [[line('other', 'project-b')], {}, /different project/],
    [[line(' ')], {}, /missing line ID/],
  ]) {
    const f = fixture();
    await assert.rejects(f.persist(items, options), message);
    assert.equal(f.state.transactions, 0);
  }
});

test('unexpected empty complete snapshots preserve existing active rows without any business write', async () => {
  const f = fixture();
  f.existing('company-a', 'project-a', 'existing');
  await assert.rejects(f.persist([]), /unexpectedly empty/);
  assert.deepEqual(f.state.calls.map(c => c.kind), ['lock', 'inspect']);
  assert.equal(f.state.rows.get('company-a/project-a/existing').source_missing_at, null);
  assert.equal(f.state.snapshots.size, 0);
  assert.equal(f.state.rollbacks, 1);
});

test('initially empty snapshots record a fence that blocks an older concurrent nonempty result', async () => {
  const f = fixture();
  const oldStart = await f.api.startBudgetSnapshot();
  assert.deepEqual(await f.persist([]), { upserted: 0, missing: 0, reconciled: true, complete: true });
  assert.equal(f.state.snapshots.get('company-a/project-a/state').source_count, 0);
  await assert.rejects(f.persist([line('old-result')], { startedAt: oldStart }), /superseded/);
  assert.equal(f.state.rows.size, 0);
  assert.equal(f.state.commits, 1);
});

test('newer state or direct row timestamps reject the entire stale snapshot before its upsert', async () => {
  for (const fence of ['state', 'synced', 'updated']) {
    const f = fixture();
    const oldStart = await f.api.startBudgetSnapshot();
    if (fence === 'state') f.state.snapshots.set('company-a/project-a/state', { last_write_at: new Date(initialTime.getTime() + 5000) });
    else f.existing('company-a', 'project-a', 'newer', {
      [fence === 'synced' ? 'synced_at' : 'updated_at']: new Date(initialTime.getTime() + 5000),
    });
    await assert.rejects(f.persist([line('old')], { startedAt: oldStart }), /superseded/);
    assert.ok(!f.state.calls.some(c => c.kind === 'upsert'));
    assert.equal(f.state.rows.has('company-a/project-a/old'), false);
  }
});

test('the database precision fence rejects a newer write within the same JavaScript millisecond', async () => {
  const f = fixture({ supersededAtDatabasePrecision: true });
  f.existing('company-a', 'project-a', 'newer', { updated_at: new Date(initialTime) });
  await assert.rejects(f.persist([line('stale')]), /superseded/);
  assert.deepEqual(f.state.calls.map(c => c.kind), ['lock', 'inspect']);
  assert.equal(f.state.rows.has('company-a/project-a/stale'), false);
});

test('any upsert, missing-marker or state failure rolls back the entire snapshot', async () => {
  for (const fail of ['upsert', 'missing', 'state']) {
    const f = fixture({ fail });
    f.existing('company-a', 'project-a', 'gone');
    await assert.rejects(f.persist([line('new')]), /Injected/);
    assert.equal(f.state.rows.has('company-a/project-a/new'), false);
    assert.equal(f.state.rows.get('company-a/project-a/gone').source_missing_at, null);
    assert.equal(f.state.snapshots.size, 0);
    assert.equal(f.state.commits, 0);
    assert.equal(f.state.rollbacks, 1);
  }
});

test('compatibility bulk imports group project scopes and preserve authoritative counts', async () => {
  const f = fixture();
  await f.persist([line('existing')]);
  const completedAt = f.state.snapshots.get('company-a/project-a/state').last_complete_at;
  const count = await f.api.batchUpsertBudgetLineItems('company-a', [line('additional'), line('other', 'project-b')]);
  assert.equal(count, 2);
  assert.deepEqual(f.state.calls.filter(c => c.kind === 'lock').map(c => c.scope),
    ['budget:company-a:project-a', 'budget:company-a:project-a', 'budget:company-a:project-b']);
  assert.equal(f.state.rows.get('company-a/project-a/existing').source_missing_at, null);
  assert.deepEqual(f.state.snapshots.get('company-a/project-a/state').last_complete_at, completedAt);
  assert.equal(f.state.snapshots.get('company-a/project-a/state').source_count, 1);
  assert.equal(await f.api.batchUpsertBudgetLineItems('company-a', []), 0);
});
