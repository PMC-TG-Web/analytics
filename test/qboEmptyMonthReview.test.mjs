import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as issueHelpers from '../src/lib/qboBillIssues.ts';

const empty = { month: '2026-08', lines: [], issues: [] };
function loader(reply, calls) {
  const imports = {
    './qboBillBridge': { hasQboBillBridge: () => true, requestQboBillBridge: async request => { calls.push(request); if (reply instanceof Error) throw reply; return reply; } },
    './qboBillIssues': issueHelpers,
  };
  const js = ts.transpileModule(fs.readFileSync('src/lib/loadQboBillReview.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { exports: m.exports, process, require: id => imports[id] || (id === 'node:path' ? { resolve: () => '.', join: (...parts) => parts.join('/') } : {}) });
  return m.exports.loadQboBillReview;
}
test('empty valid month reads ledger only and never prepares or reserves a bill', async () => {
  const calls = [];
  const review = await loader({ connected: true, action: 'create', issues: [] }, calls)('1', '2', '2026-08', empty, true);
  assert.equal(review.action, 'no_activity');
  assert.equal(review.issues.length, 0);
  assert.equal(review.canPost, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'status');
  assert.equal(calls[0].draft, undefined);
});
test('removed costs cannot hide an existing QBO bill', async () => {
  const review = await loader({ connected: true, billId: '99', action: 'update', issues: [] }, [])('1', '2', '2026-08', empty);
  assert.equal(review.action, 'reconcile');
  assert.match(review.issues[0], /no eligible costs.*QBO bill already exists/);
  assert.equal(review.canPost, false);
});
test('pending reconciliation stays visible even without a receipt bill ID', async () => {
  const review = await loader({ connected: true, action: 'reconcile', issues: [] }, [])('1', '2', '2026-08', empty);
  assert.equal(review.action, 'reconcile');
});
test('empty output from missing prices still validates and reports source issues', async () => {
  const calls = [];
  const draft = { ...empty, issues: ['Curing compound needs a price.'] };
  const review = await loader({ connected: true, action: 'create', issues: draft.issues }, calls)('1', '2', '2026-08', draft, true);
  assert.equal(calls[0].operation, 'prepare');
  assert.equal(calls[0].draft, draft);
  assert.match(review.issues[0], /Curing compound/);
  assert.notEqual(review.action, 'no_activity');
});
test('unavailable host cannot be mistaken for a clean empty month', async () => {
  const review = await loader(new Error('offline'), [])('1', '2', '2026-08', empty, true);
  assert.equal(review.action, 'unavailable');
  assert.match(review.issues[0], /Status could not be verified/);
});
test('nonempty months retain ordinary prepare validation', async () => {
  const calls = [];
  const draft = { ...empty, lines: [{ lineKey: 'labor:03-300-30-10' }] };
  await loader({ connected: true, action: 'update', issues: [] }, calls)('1', '2', '2026-08', draft, true);
  assert.equal(calls[0].operation, 'prepare');
  assert.equal(calls[0].draft, draft);
});
