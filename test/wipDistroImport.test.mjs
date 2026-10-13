import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareWipDistroImport } from '../src/lib/wipDistroImport.ts';
const header = ['Customer/Project Name', 'Project Hours', 'Contract Total', 'WIP Distro Dates', '% of ', 'Contract total', 'Project Hours'];
const date = month => (Date.parse(`${month}-01T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
const row = (name, month, percent) => [name, 999, 0, date(month), percent / 100, 0, 999];
const source = { bidBoardId: '11', proposalId: '22', estimatedHours: 1200, projectManagementHours: 200, allocatableHours: 1000 };
const project = { projectId: '101', projectName: 'Project X', source, issue: null, plan: null };
const prepare = (rows, mapping = { 'GC/Project X': '101' }, projects = [project], exclude = []) => prepareWipDistroImport([header, ...rows], projects, mapping, 'company', 'pm@example.com', '2026-10-12T00:00:00Z', exclude);

test('dates span years, percentages preserve precision, and saved hours use the selected estimate excluding PM', () => {
  const { store } = prepare([row('GC/Project X', '2026-10', 40), row('GC/Project X', '2026-11', 40), row('GC/Project X', '2027-01', 20)]);
  assert.deepEqual(store.plans['101'].allocations, [{ month: '2026-10', percent: 40 }, { month: '2026-11', percent: 40 }, { month: '2027-01', percent: 20 }]);
  assert.deepEqual(store.plans['101'].source, source);
  assert.equal(store.history['101'].length, 1);
});
test('case and whitespace variants group together; duplicate months sum once, never normalize to 100', () => {
  const { store } = prepare([row('GC/Project X', '2026-07', 2.75), row('gc/project x ', '2026-07', 9), row('GC/Project X', '2026-10', 90)]);
  assert.equal(store.plans['101'], undefined);
  assert.equal(store.drafts['101'].allocations[0].percent, 11.75);
  const corrected = prepare([row('GC/Project X', '2026-07', 2.75), row('gc/project x ', '2026-07', 9), row('GC/Project X', '2026-10', 90)], undefined, undefined, [2]);
  assert.equal(corrected.store.drafts['101'].allocations[0].percent, 9);
  assert.equal(corrected.report[0].totalPercent, 99);
});
test('unmapped projects stay outside WIP and incomplete percentages stay editable drafts', () => {
  const { store, report } = prepare([row('GC/Project X', '2026-10', 25), row('Unmatched', '2026-10', 100)]);
  assert.equal(Object.keys(store.plans).length, 0);
  assert.equal(store.drafts['101'].allocations[0].percent, 25);
  assert.equal(report[1].projectId, null);
});
test('existing plans, ambiguous targets, invalid cells and unknown mappings block import', () => {
  const rows = [row('GC/Project X', '2026-10', 100)];
  assert.throws(() => prepare(rows, undefined, [{ ...project, plan: { revision: 1 } }]), /already planned/);
  assert.throws(() => prepare(rows, undefined, [project, project]), /ambiguous/);
  assert.throws(() => prepare(rows, { 'Missing': '101' }), /absent/);
  assert.throws(() => prepare([row('GC/Project X', '2026-10', 100.1)]), /Invalid/);
  assert.throws(() => prepare([['GC/Project X', 1, 0, 'Oct', 1]]), /Invalid/);
  assert.throws(() => prepare([row('GC/Project X', '2026-10', 0.001)]), /Invalid/);
});

test('compact Distro Dates exports add prior-year months and retain unmatched historical allocations', () => {
  const rows = [['Customer/Project Name', 'Distro Dates', '% of '],
    ['GC/Project X', date('2025-11'), 0.08], ['GC/Project X', date('2026-12'), 0.72],
    ['GC/Project X', date('2027-01'), 0.20], ['Historical project', date('2025-01'), 0.5]];
  const { store, report } = prepareWipDistroImport(rows, [project], { 'GC/Project X': '101' }, 'company', 'pm', '2026-10-13');
  assert.deepEqual(store.plans['101'].allocations, [{ month: '2025-11', percent: 8 }, { month: '2026-12', percent: 72 }, { month: '2027-01', percent: 20 }]);
  assert.deepEqual(report[1].allocations, [{ month: '2025-01', percent: 50 }]);
  assert.equal(report[1].projectId, null);
});

test('headers determine columns and ambiguous or missing date headers fail closed', () => {
  const run = rows => prepareWipDistroImport(rows, [project], { 'GC/Project X': '101' }, 'company', 'pm', '2026-10-13');
  assert.equal(run([['% of ', 'Distro Dates', 'Customer/Project Name'], [1, date('2025-10'), 'GC/Project X']]).store.plans['101'].allocations[0].percent, 100);
  assert.throws(() => run([['Customer/Project Name', 'Distro Dates', 'WIP Distro Dates', '% of']]), /exactly one/);
  assert.throws(() => run([['Customer/Project Name', '% of']]), /exactly one/);
});
