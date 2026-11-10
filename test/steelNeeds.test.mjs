import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSteelNeeds, aggregateSteelNeeds, filterSteelProjects, steelKind, steelNeedsCsv } from '../src/lib/steelNeeds.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';
import { apiPagePermissions } from '../src/lib/independentPagePermissions.js';
import { expandAssignedPermissions } from '../src/lib/permissions.ts';

export const source = { bidBoardId: 'b1', proposalId: 'e1', estimatedHours: 100, projectManagementHours: 0, allocatableHours: 100 };
export const project = { key: 'p1', projectId: 'p1', projectName: 'Warehouse', projectNumber: '100', customer: 'Customer', projectManager: '', source, issue: null, plan: { revision: 1, source, allocations: [{ month: '2027-01', percent: 50 }, { month: '2026-11', percent: 50 }], notes: '', updatedBy: '', updatedAt: '2026-11-10' } };
export const line = { companyId: 'company', bidBoardProjectId: 'b1', proposalId: 'e1', lineItemId: 'l1', name: "#4 Rebar - 20' Pc", uom: 'EA', quantity: 100, syncedAt: '2026-11-10T12:00:00Z', payload: { cost_item: { type: 'CUSTOM', description: '#5 Rebar By The Piece' } } };
const filters = { status: '', kind: '', query: '', projectId: '', through: '', timing: '' };

test('full estimated quantities use exact proposal identity and retain material specifications and units', () => {
  const rows = buildSteelNeeds('company', [project], [line,
    { ...line, lineItemId: 'l2', name: " #4  rebar - 20' pc ", uom: 'pieces', quantity: 50 },
    { ...line, lineItemId: 'l3', name: "#5 Rebar - 20' Pc", quantity: 20 },
    { ...line, lineItemId: 'l4', uom: 'LF', quantity: 400 },
    { ...line, proposalId: 'alternate', quantity: 9999 }, { ...line, bidBoardProjectId: 'other', quantity: 9999 },
    { ...line, companyId: 'other', quantity: 9999 },
  ], [{ projectId: 'p1', dailyLogs: 4, timesheets: 0, firstActivity: '2026-11-09' }]);
  assert.equal(rows[0].items.length, 3);
  assert.equal(rows[0].items.find(item => item.unit === 'EA' && item.description.startsWith('#4')).quantity, 150);
  assert.equal(rows[0].started, true);
  assert.equal(rows[0].plannedStart, '2026-11');
  assert.equal(rows[0].firstActivity, '2026-11-09');
  assert.equal(rows[0].issues.length, 0);
});

test('either field source starts a project; none means not started, while unlinked stays unknown', () => {
  for (const entries of [{ dailyLogs: 1, timesheets: 0 }, { dailyLogs: 0, timesheets: 1 }]) {
    assert.equal(buildSteelNeeds('company', [project], [line], [{ ...entries, projectId: 'p1', firstActivity: '2026-01-01' }])[0].started, true);
  }
  assert.equal(buildSteelNeeds('company', [project], [line], [])[0].started, false);
  const missing = buildSteelNeeds('company', [{ ...project, projectId: null }], [line], [])[0];
  assert.equal(missing.started, null); assert.equal(missing.items.length, 0); assert.ok(missing.issues.length);
});

test('material scope excludes labor, accessories and fiber, while wire specs and tie wire qualify', () => {
  for (const name of ['Rebar Fabrication', 'Rebar Labor', '#4 Rebar Speed Dowel Tube', 'F100 Fiber Mesh', 'Rebar chairs']) assert.equal(steelKind(name), null);
  assert.equal(steelKind('#4 Rebar', 'LABOR'), null);
  assert.equal(steelKind('#4 Rebar', 'CUSTOM', 'hours'), null);
  for (const name of ['Wire Mesh 4 ga (4.0x4.0 4x4)', 'WWF 6x6', 'Tie Wire']) assert.equal(steelKind(name), 'Wire');
});

test('missing/invalid quantities and units remain visible, no-hour jobs retain steel, ambiguous estimates are withheld', () => {
  const row = buildSteelNeeds('company', [{ ...project, issue: 'No positive estimated hours available after excluding Project Management.', plan: null }], [line,
    { ...line, lineItemId: 'bad', quantity: null }, { ...line, lineItemId: 'negative', quantity: -1 },
    { ...line, lineItemId: 'unit', uom: null }, { ...line, lineItemId: 'zero', quantity: 0 },
  ], [])[0];
  assert.equal(row.items[0].quantity, 100); assert.equal(row.issues.length, 4); assert.equal(row.plannedStart, null);
  const ambiguous = buildSteelNeeds('company', [{ ...project, issue: 'Multiple estimates link to this project.' }], [line], [])[0];
  assert.equal(ambiguous.items.length, 0);
  const missing = buildSteelNeeds('company', [project], [], [])[0];
  assert.match(missing.issues.join(' '), /requirements are unknown/);
  assert.throws(() => buildSteelNeeds('company', [project], [line, line], []), /Repeated/);
});

test('saved WIP months cross years, flag changed basis, and ignore zero allocations', () => {
  const row = buildSteelNeeds('company', [{ ...project, plan: { ...project.plan, source: { ...source, estimatedHours: 200 }, allocations: [{ month: '2026-01', percent: 0 }, { month: '2027-02', percent: 100 }] } }], [line], [])[0];
  assert.equal(row.plannedStart, '2027-02'); assert.equal(row.planChanged, true);
});

test('filters, totals and CSV use one consistent project/material scope without adding incompatible units', () => {
  const second = { ...project, key: 'p2', projectId: 'p2', projectName: '=Customer job', source: { ...source, bidBoardId: 'b2' }, plan: null };
  const rows = buildSteelNeeds('company', [project, second], [line, { ...line, bidBoardProjectId: 'b2', quantity: 40 }], [{ projectId: 'p1', dailyLogs: 1, timesheets: 0, firstActivity: '2026-11-01' }]);
  const total = aggregateSteelNeeds(rows)[0];
  assert.equal(total.quantity, 140); assert.equal(total.startedQuantity, 100); assert.equal(total.notStartedQuantity, 40);
  assert.equal(filterSteelProjects(rows, { ...filters, through: '2026-11' }).length, 1);
  assert.equal(filterSteelProjects(rows, { ...filters, through: '2026-10' }).length, 0);
  const unstarted = filterSteelProjects(rows, { ...filters, status: 'not-started' });
  assert.equal(aggregateSteelNeeds(unstarted)[0].quantity, 40);
  assert.equal(filterSteelProjects(rows, { ...filters, timing: 'unscheduled' })[0].key, 'p2');
  assert.equal(filterSteelProjects(rows, { ...filters, query: '#5' }).length, 0);
  const csv = steelNeedsCsv(unstarted);
  assert.match(csv, /"40"/); assert.doesNotMatch(csv, /Warehouse/); assert.match(csv, /"'=Customer job"/);
});

test('Steel needs has independent page/API/help access and admin defaults without granting sibling WIP data', () => {
  for (const path of ['/steel-needs', '/help/steel-needs', '/api/steel-needs']) assert.equal(resolvePermissionForPath(path), 'steel-needs');
  assert.deepEqual(apiPagePermissions('/api/steel-needs'), ['page:/steel-needs']);
  assert.equal(resolvePermissionForPath('/api/steel-needs-unrelated'), null);
  const granted = expandAssignedPermissions(['page:/steel-needs']);
  assert.ok(granted.includes('page:/help/steel-needs')); assert.ok(!granted.includes('page:/wip'));
  assert.ok(!expandAssignedPermissions(['wip']).includes('page:/steel-needs'));
  for (const role of ['OWNER', 'ADMIN']) assert.ok(expandAssignedPermissions([role]).includes('page:/steel-needs'));
  assert.ok(!expandAssignedPermissions(['OWNER', '!page:/steel-needs']).includes('page:/steel-needs'));
});
