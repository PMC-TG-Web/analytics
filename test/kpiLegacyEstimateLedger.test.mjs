import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLegacyEstimateLedger, parseLegacyEstimateLedger, legacySnapshotHash, unmigratedLegacySnapshots } from '../src/lib/kpiLegacyEstimateLedger.ts';
import { calculateEstimatePreview } from '../src/lib/kpiEstimatePreview.ts';

const old = '598134325658789', current = '598134325805519';
const policy = { groups: [], excludedSources: [] };
const bid = (id, extra = {}) => ({ companyId: old, bidBoardId: id, projectName: `Old job ${id}`, status: 'BID_SUBMITTED', payload: { created_on: '2026-02-01T12:00:00Z', stats: { total: 100000.129 } }, syncedAt: new Date('2026-10-07T12:00:00Z'), ...extra });
const build = (rows, nowRows = [], rules = policy, evidence = []) => buildLegacyEstimateLedger(rows, nowRows, rules, evidence, new Date('2026-11-02T12:00:00Z'));

test('unmigrated retained bids preserve dollars and mark unavailable hours null, including true zero dollars', () => {
  const ledger = build([bid('1'), bid('2', { payload: { created_on: '2026-02-01', stats: { total: 0 } } })]);
  assert.equal(ledger.records.length, 2);
  assert.equal(ledger.records[0].snapshot.sales, 100000.13);
  assert.equal(ledger.records[1].snapshot.sales, 0);
  assert.equal(ledger.records[0].snapshot.hours, null);
  assert.equal(ledger.records[0].snapshot.includesProjectManagement, true);
  assert.deepEqual(parseLegacyEstimateLedger(JSON.parse(JSON.stringify(ledger))), ledger);
});

test('reviewed migration aliases and explicit source IDs exclude current copies even after rename or archive', () => {
  const rules = { groups: [{ key: 'moved', preferredSource: `${old}:1`, names: ['Different'], sourceIds: [`${old}:1`, `${current}:2`], createdDate: '2026-01-01' }], excludedSources: [] };
  const result = build([bid('1'), bid('3')], [bid('2', { companyId: current, projectName: 'Renamed', payload: { archived: true } })], rules);
  assert.equal(result.skippedMigrated, 1);
  assert.deepEqual(result.records.map(r => r.snapshot.bidBoardId), ['3']);
});

test('same normalized report name matches contractor copies, without changing source identity', () => {
  const result = build([bid('1', { projectName: 'A Job' }), bid('3')], [bid('2', { companyId: current, projectName: 'A-Job' })]);
  assert.equal(result.skippedMigrated, 1);
  assert.equal(result.records[0].snapshot.companyId, old);
  assert.equal(result.records[0].snapshot.bidBoardId, '3');
});

test('latest current migration matches are rechecked when reading an earlier ledger file', () => {
  const result = build([bid('1')]);
  assert.equal(unmigratedLegacySnapshots(result.records.map(r => r.snapshot), [bid('2', { companyId: current, projectName: 'Old job 1' })], policy).length, 0);
});

test('matching input is idempotent; a later correction has a new snapshot hash', () => {
  const first = build([bid('1')]);
  const later = buildLegacyEstimateLedger([bid('1')], [], policy, [], new Date('2026-12-01T12:00:00Z'));
  assert.equal(first.records[0].hash, later.records[0].hash);
  const evidence = [{ companyId: old, bidBoardId: '1', proposalId: '10', hours: 123.4567, sales: 100000.13, includesProjectManagement: true, source: 'Reviewed full estimate export' }];
  const corrected = build([bid('1')], [], policy, evidence);
  assert.notEqual(corrected.records[0].hash, first.records[0].hash);
  assert.equal(corrected.records[0].snapshot.hours, 123.4567);
  assert.equal(first.records[0].snapshot.hours, null);
});

test('evidence requires exact old IDs, full PM-inclusive hours, a source, and one reviewed primary', () => {
  const row = { companyId: old, bidBoardId: '1', proposalId: '10', hours: 0, sales: 0, includesProjectManagement: true, source: 'Reviewed export' };
  for (const changed of [{ companyId: current }, { bidBoardId: 'unknown' }, { bidBoardId: '99' }, { includesProjectManagement: false }, { source: '' }, { hours: -1 }, { hours: Number.NaN }]) {
    assert.throws(() => build([bid('1')], [], policy, [{ ...row, ...changed }]));
  }
  assert.throws(() => build([bid('1')], [], policy, [row, row]), /Duplicate estimate evidence/);
  assert.equal(build([bid('1')], [], policy, [row]).records[0].snapshot.hours, 0);
});

test('hash validation rejects changed values, duplicate sources, wrong company and extra payload fields', () => {
  const original = build([bid('1')]);
  const altered = structuredClone(original); altered.records[0].snapshot.sales = 9;
  assert.throws(() => parseLegacyEstimateLedger(altered));
  assert.throws(() => parseLegacyEstimateLedger({ ...original, records: [original.records[0], original.records[0]] }));
  const wrong = structuredClone(original); wrong.records[0].snapshot.companyId = current;
  wrong.records[0].hash = legacySnapshotHash(wrong.records[0].snapshot);
  assert.throws(() => parseLegacyEstimateLedger(wrong));
  const extra = structuredClone(original); extra.records[0].snapshot.rawPayload = {};
  extra.records[0].hash = legacySnapshotHash(extra.records[0].snapshot);
  assert.throws(() => parseLegacyEstimateLedger(extra));
});

test('raw payload contact data is not copied into historical estimate snapshots', () => {
  const result = build([bid('1', { payload: { created_on: '2026-02-01', stats: { total: 100 }, contact_email: 'private@example.invalid', access_token: 'fixture' } })]);
  assert.doesNotMatch(JSON.stringify(result), /contact_email|access_token|private@example/);
});

test('historical dollars supplement the preview once per group while missing hours stay incomplete', () => {
  const october = { created_on: '2026-10-01', stats: { total: 100000.129 } };
  const bids = [bid('1', { payload: october }), bid('2', { projectName: 'Old job 1', payload: october })];
  const ledger = build(bids);
  const report = calculateEstimatePreview(bids, [], [], policy, [], new Date('2026-11-02'), ledger.records.map(r => r.snapshot));
  assert.equal(report.projects.length, 1);
  assert.equal(report.months['2026-10'].sales, 100000.13);
  assert.equal(report.months['2026-10'].missingHours, 1);
  assert.equal(report.months['2026-10'].missingSales, 0);
  assert.ok(report.projects[0].legacySource);
});

test('complete historical evidence supplies hours including PM without a fabricated revision', () => {
  const rows = [bid('1', { payload: { created_on: '2026-10-01' } })];
  const evidence = [{ companyId: old, bidBoardId: '1', proposalId: '10', hours: 500, sales: 100000, includesProjectManagement: true, source: 'Reviewed full estimate export' }];
  const ledger = build(rows, [], policy, evidence);
  const report = calculateEstimatePreview(rows, [], [], policy, [], new Date('2026-11-02'), ledger.records.map(r => r.snapshot));
  assert.equal(report.months['2026-10'].hours, 500);
  assert.equal(report.months['2026-10'].missingHours, 0);
  assert.equal(report.months['2026-10'].rebids, 0);
});

test('pre-cutover legacy evidence is preserved without recalculating saved historical months', () => {
  const rows = [bid('1')];
  const ledger = build(rows);
  const before = JSON.stringify(ledger);
  const report = calculateEstimatePreview(rows, [], [], policy, [], new Date('2026-11-03'), ledger.records.map(r => r.snapshot));
  assert.deepEqual(report.months, {});
  assert.equal(report.projects.length, 0);
  assert.equal(JSON.stringify(ledger), before);
});

test('database import is append-only, explicitly applied, checksum-bound and company-scoped', () => {
  const importer = readFileSync(new URL('../scripts/importKpiLegacyEstimateLedger.mjs', import.meta.url), 'utf8');
  assert.match(importer, /args.includes\('--apply'\)/);
  assert.match(importer, /arg\('--company'\) !== KPI_OLD_COMPANY/);
  assert.match(importer, /arg\('--expect-sha256'\) !== sha256/);
  assert.match(importer, /skipDuplicates: true/);
  assert.doesNotMatch(importer, /p(?:\.[A-Za-z]+)?\.(update|updateMany|delete|deleteMany|executeRaw)\(/);
  const loader = readFileSync(new URL('../src/lib/loadKpiLegacyEstimateLedger.ts', import.meta.url), 'utf8');
  assert.match(loader, /NODE_ENV === 'development'/);
  assert.match(loader, /companyId: KPI_OLD_COMPANY/);
  const migration = readFileSync(new URL('../prisma/migrations/20261102190000_kpi_legacy_estimate_ledger/migration.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});
