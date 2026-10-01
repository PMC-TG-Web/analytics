import * as projectPolicy from '../src/lib/qboBillProjectPolicy.ts';
// Opt-in rehearsal: real, isolated LOCAL PostgreSQL; simulated external services.
// Never imports dotenv, the application Prisma singleton, or any live API module.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID, createHash } from 'node:crypto';
import ts from 'typescript';
import pg from 'pg';
import { PrismaClient, Prisma } from '@prisma/client';
import * as batch from '../src/lib/qboBillBatch.ts';
import { matchQboCustomer } from '../src/lib/qboCustomerMatch.ts';

const database = process.env.QBO_BATCH_TEST_DATABASE_URL;
function moduleFromFile(file, imports, env) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { exports: m.exports, Date, Error, process: { env }, require: id => {
    if (!(id in imports)) throw new Error(`Test refused an unmocked dependency: ${id}`);
    return imports[id];
  } });
  return m.exports;
}

test('monthly batch rehearsal: real database, mocked Procore/QBO, restart, errors and retry', { skip: !database, timeout: 120_000 }, async t => {
  const url = new URL(database);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only a local test server is allowed');
  assert.match(url.pathname, /^\/qbo_batch_test[a-z0-9_]*$/);
  assert.notEqual(database, process.env.DATABASE_URL, 'Refuse the configured application database');
  assert.equal(url.port, '55439', 'Dedicated test-cluster port required');
  const schema = `batch_test_${randomUUID().replaceAll('-', '')}`;
  const sql = new pg.Client({ connectionString: database }); await sql.connect();
  await sql.query(`CREATE SCHEMA "${schema}"`);
  await sql.query(`SET search_path TO "${schema}"`);
  await sql.query(fs.readFileSync('prisma/migrations/20260929150000_qbo_bill_batches/migration.sql', 'utf8'));
  await sql.query('CREATE TABLE pmc_projects (company_id TEXT NOT NULL, procore_project_id TEXT NOT NULL, project_name TEXT NOT NULL, PRIMARY KEY(company_id, procore_project_id))');
  url.searchParams.set('schema', schema);
  let prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
  const env = { PROCORE_COMPANY_ID: '1', QBO_BILL_BATCH_ENABLED: 'true', QBO_BILL_BATCH_MAX_PROJECTS: '10' };
  const scenarios = new Map([
    ['10', { name: 'Existing bill', kind: 'update' }], ['20', { name: 'New bill', kind: 'create' }],
    ['30', { name: 'Already current', kind: 'current' }], ['40', { name: 'No activity', kind: 'empty' }],
    ['50', { name: 'Missing catalog price', kind: 'price' }], ['60', { name: 'Procore quota wait', kind: 'quota' }],
    ['70', { name: 'Lost QBO response', kind: 'lost' }], ['80', { name: 'Ambiguous customer', kind: 'customer' }],
    ['90', { name: 'Manual changes', kind: 'reconcile' }], ['100', { name: 'Changed during save', kind: 'changed' }],
  ]);
  for (const [id, s] of scenarios) await sql.query('INSERT INTO pmc_projects VALUES ($1,$2,$3)', ['1', id, s.name]);
  const counters = { refreshes: 0, setup: 0, budget: 0, postCalls: {}, saves: {}, quotaWaits: 0, workerRestarts: 0 };
  const mapped = new Set([...scenarios.keys()].filter(id => !['20', '80'].includes(id)));
  const bills = new Map([...scenarios.keys()].filter(id => !['20', '40', '80'].includes(id)).map(id => [id, { id: `bill-${id}`, sourceVersion: id === '30' ? 1 : 0, billNumber: `${scenarios.get(id).name} 001`, manualLines: [{ description: 'Added directly in QBO', amount: 1520 }] }]));
  let corrected = false;
  let dropCheckpoint = true;
  const versions = new Map([...scenarios.keys()].map(id => [id, 1]));
  const fingerprint = d => createHash('sha256').update(`${d.projectId}:${d.version}`).digest('hex');
  async function loadDraft(companyId, projectId, month) {
    const s = scenarios.get(projectId);
    const issues = s.kind === 'price' && !corrected ? ['Curing compound needs a price. PO-002; daily log 2026-09-12.'] : [];
    return { companyId, projectId, month, projectName: s.name, projectNumber: `TEST-${projectId}`, version: versions.get(projectId),
      issues, issueSources: issues.map(message => ({ message, date: '2026-09-12', purchaseOrderId: '222' })), lines: s.kind === 'empty' ? [] : [{ lineKey: 'line1' }] };
  }
  async function review(_company, id, _month, draft) {
    const bill = bills.get(id); const s = scenarios.get(id);
    const reconcile = s.kind === 'reconcile' && !corrected;
    return { connected: mapped.has(id), action: reconcile ? 'reconcile' : bill?.sourceVersion === draft.version ? 'current' : bill ? 'update' : 'create',
      billId: bill?.id || null, billNumber: bill?.billNumber || null, canPost: !reconcile, fingerprint: fingerprint(draft),
      issues: reconcile ? ['Bill changed in QBO; reconcile manual changes before updating.'] : [], products: mapped.has(id) ? { line1: `TEST-${id}-03-200-30-20.M` } : {} };
  }
  async function bridge(request) {
    const { operation, projectId: id, draft } = request; const s = scenarios.get(id);
    assert.equal(request.actor, 'tester@example.test', 'Worker must retain original session attribution');
    if (operation === 'setup-options') return { customerId: null, customers: s.kind === 'customer' && !corrected ? [{ id: '1', name: s.name, fullName: `A:${s.name}` }, { id: '2', name: s.name, fullName: `B:${s.name}` }] : [{ id: '1', name: s.name, fullName: `A:${s.name}` }] };
    if (operation === 'budget-plan') return { products: [`TEST-${id}-03-200-30-20.M`] };
    if (operation === 'setup') { counters.setup++; mapped.add(id); return { complete: true, remaining: 0 }; }
    assert.equal(operation, 'post'); counters.postCalls[id] = (counters.postCalls[id] || 0) + 1;
    // Simulate the host rejecting a stale source fingerprint before its writer.
    if (s.kind === 'changed' && counters.postCalls[id] === 1) {
      versions.set(id, 2); throw new Error('Monthly costs or mappings changed. Reopen the project review before posting.');
    }
    assert.equal(request.fingerprint, fingerprint(draft));
    const previous = bills.get(id);
    bills.set(id, { id: previous?.id || `bill-${id}`, billNumber: previous?.billNumber || `${s.name} 001`, sourceVersion: draft.version, manualLines: previous?.manualLines || [] });
    counters.saves[id] = (counters.saves[id] || 0) + 1;
    if (s.kind === 'lost' && counters.saves[id] === 1) throw new Error('QBO saved, but the response timed out');
    return { billNumber: bills.get(id).billNumber, updated: !!previous };
  }
  function modules() {
    const store = moduleFromFile('src/lib/qboBillBatchStore.ts', { './qboBillProjectPolicy': projectPolicy, 'node:crypto': { randomUUID }, '@prisma/client': { Prisma }, './prisma': { prisma }, './qboBillBatch': batch }, env);
    const worker = moduleFromFile('src/lib/runQboBillBatch.ts', {
      './qboBillProjectPolicy': projectPolicy, './prisma': { prisma }, './qboBillBatch': batch, './qboBillBatchStore': { ...store, saveBillBatchStep: async (...args) => {
        if (args[2] === '70' && args[4].stage === 'verify' && dropCheckpoint) {
          dropCheckpoint = false; throw new Error('Simulated worker stopped before checkpoint');
        }
        return store.saveBillBatchStep(...args);
      } },
      './qboBillBatchSources': { refreshBillBatchSources: async (_c, id, _m, stage) => {
        counters.refreshes++; if (id === '60' && stage === 'daily_logs' && counters.quotaWaits++ === 0) throw new batch.BatchWait('Procore quota recovery', 1000);
      } },
      './loadQboDirectCosts': { loadQboDirectCosts: loadDraft }, './loadQboBillReview': { loadQboBillReview: review },
      './qboBillBridge': { requestQboBillBridge: bridge }, './qboCustomerMatch': { matchQboCustomer },
      './ensureQboBudgetReadiness': { ensureQboBudgetReadiness: async () => { counters.budget++; return { ready: true, message: 'Budget ready' }; } },
    }, env);
    return { store, worker };
  }
  let { store, worker } = modules();
  try {
    const requests = await Promise.all([1, 2, 3].map(() => store.startBillBatch('1', '2026-09', 'tester@example.test', randomUUID(), undefined, [...scenarios.keys()])));
    const runId = requests[0].id;
    assert.ok(requests.every(r => r.id === runId)); assert.equal(await prisma.qboBillBatchRun.count(), 1);
    const leases = await Promise.all([store.claimBillBatch(), store.claimBillBatch(), store.claimBillBatch()]);
    assert.equal(leases.filter(Boolean).length, 1, 'Only one real database lease may win');
    const claimed = leases.find(Boolean);
    await prisma.qboBillBatchRun.update({ where: { id: runId }, data: { leaseUntil: new Date(0) } });
    const replacement = await store.claimBillBatch();
    await assert.rejects(store.markBatchWrite(runId, claimed.leaseToken, '10'), /lease expired/);
    assert.equal((await prisma.qboBillBatchProject.findUnique({ where: { runId_projectId: { runId, projectId: '10' } } })).writeStartedAt, null);
    await store.finishBillBatchTick(runId, replacement.leaseToken);
    let interrupted = false;
    async function drain(id) {
      for (let n = 0; n < 250; n++) {
        try { await worker.runQboBillBatchTick(); }
        catch (error) { assert.equal(error.message, 'Simulated worker stopped before checkpoint'); }
        const saved = await prisma.qboBillBatchProject.findFirst({ where: { runId: id, projectId: '70', writeStartedAt: { not: null } } });
        if (saved && !interrupted) {
          assert.ok(saved.writeStartedAt); assert.equal(saved.stage, 'post'); interrupted = true;
          // Discard the worker/client; only persisted database state survives.
          await prisma.$disconnect(); prisma = new PrismaClient({ datasources: { db: { url: url.href } } });
          ({ store, worker } = modules()); counters.workerRestarts++;
        }
        const run = await prisma.qboBillBatchRun.findUnique({ where: { id } });
        if (run.status === 'complete') return;
        // Advance only the isolated test queue instead of sleeping for real backoff.
        await prisma.qboBillBatchProject.updateMany({ where: { runId: id, status: 'waiting' }, data: { nextAttemptAt: new Date(0) } });
      }
      assert.fail('Run did not finish within the bounded rehearsal');
    }
    await drain(runId);
    const first = await store.getBillBatch('1', '2026-09');
    const expected = { '10': 'updated', '20': 'created', '30': 'current', '40': 'empty', '50': 'needs_attention', '60': 'updated', '70': 'updated', '80': 'needs_attention', '90': 'needs_attention', '100': 'updated' };
    assert.deepEqual(Object.fromEntries(first.projects.map(p => [p.projectId, p.status])), expected);
    assert.equal(first.finished, 10); assert.equal(counters.workerRestarts, 1); assert.equal(counters.postCalls['70'], 1, 'Lost response must not repeat a financial save');
    assert.equal(counters.postCalls['100'], 2); assert.equal(counters.saves['100'], 1, 'Stale review rejection must not double-save');
    assert.equal(counters.saves['50'], undefined, 'Unpriced project must stay untouched');
    assert.equal(bills.get('50').sourceVersion, 0); assert.equal(bills.get('10').manualLines[0].amount, 1520);
    const issue = first.projects.find(p => p.projectId === '50'); assert.equal(issue.issueSources[0].purchaseOrderId, '222');
    const savesBeforeRetry = { ...counters.saves };
    corrected = true;
    const retried = await store.startBillBatch('1', '2026-09', 'tester@example.test', randomUUID(), runId);
    const selected = await prisma.qboBillBatchProject.findMany({ where: { runId: retried.id } });
    assert.deepEqual(selected.map(p => p.projectId).sort(), ['50', '80', '90']);
    await drain(retried.id);
    const second = await store.getBillBatch('1', '2026-09'); assert.equal(second.finished, 3); assert.ok(second.projects.every(p => ['created', 'updated'].includes(p.status)));
    for (const id of Object.keys(savesBeforeRetry)) assert.equal(counters.saves[id], savesBeforeRetry[id], 'Retry must not revisit successful projects');
    assert.equal(await prisma.qboBillBatchRun.count({ where: { activeKey: '1' } }), 0);
    const report = { mode: 'isolated local PostgreSQL; simulated Procore/QBO', schema, firstRun: first.projects.map(p => ({ project: p.projectName, result: p.status })), retry: second.projects.map(p => ({ project: p.projectName, result: p.status })), counters };
    fs.mkdirSync('.tmp', { recursive: true }); fs.writeFileSync('.tmp/bill-batch-rehearsal-results.json', JSON.stringify(report, null, 2));
    t.diagnostic(`Rehearsed ${first.total} projects, restarted once, corrected and retried ${second.total}; no duplicate saves.`);
  } finally { await prisma.$disconnect(); await sql.end(); }
});
