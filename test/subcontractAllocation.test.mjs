import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAllocationChanges, allocationTotals, allocationEligible, estimateAllocationUnitCost, toggleSubcontractAllocation, allocationGroupCheck } from '../src/lib/subcontractAllocation.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';
import { canAccessSubcontractAllocation, isSubcontractAllocationPath } from '../src/lib/subcontractAllocationAccess.ts';

test('private rollout admits only Todd, regardless of broader roles', () => {
  assert.equal(canAccessSubcontractAllocation(' TODD@PMCDECOR.COM '), true);
  for (const email of [null, undefined, '', 'david@pmcdecor.com', 'admin@pmcdecor.com', 'todd@pmcdecor.com.attacker.com']) {
    assert.equal(canAccessSubcontractAllocation(email), false);
  }
  assert.equal(isSubcontractAllocationPath('/api/procore/commitments-live/allocation/history'), true);
  assert.equal(isSubcontractAllocationPath('/procore/commitments-live/allocation'), true);
  assert.equal(isSubcontractAllocationPath('/procore/commitments-live/maker'), false);
  assert.equal(isSubcontractAllocationPath('/procore/commitments-live/allocation-other'), false);
});

test('private rollout is enforced by middleware, server layout, both API methods and navigation', () => {
  const route = readFileSync(new URL('../src/app/api/procore/commitments-live/allocation/route.ts', import.meta.url), 'utf8');
  assert.equal((route.match(/!canAccessSubcontractAllocation\(actor\)/g) || []).length, 2);
  const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(middleware, /isSubcontractAllocationPath\(pathname\) && session && !canAccessSubcontractAllocation\(session.user\?\.email\)/);
  const layout = readFileSync(new URL('../src/app/procore/commitments-live/allocation/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /canAccessSubcontractAllocation\(await getAllocationUserEmail\(\)\)/);
  const nav = readFileSync(new URL('../src/components/Navigation.tsx', import.meta.url), 'utf8');
  assert.match(nav, /!isSubcontractAllocationPath\(link.href\) \|\| canAccessSubcontractAllocation\(user\?\.email\)/);
});

const source = {
  projectId: '1', projectName: 'Project', bidBoardProjectId: '2', proposalId: '3', proposalName: 'Primary', syncedAt: '',
  lines: [
    { id: 'a', groupId: 'g', groupName: 'Concrete', name: 'Concrete', costCode: '01', uom: 'cy', quantity: 20, unitCost: 125.25 },
    { id: 'b', groupId: 'g', groupName: 'Concrete', name: 'Labor', costCode: '02', uom: 'hr', quantity: 10, unitCost: 0 },
    { id: 'missing', groupId: 'g', groupName: 'Concrete', name: 'Missing', costCode: '', uom: '', quantity: 5, unitCost: null },
  ],
  budgets: [{ id: 'budget1', name: 'Materials', costCode: '01', amount: 2505 }, { id: 'budget2', name: 'Subcontract', costCode: '02', amount: 0 }],
  poLines: [
    { id: 'po1line', poId: 'po1', poName: 'PO1', name: 'Concrete', quantity: 20, unitCost: 120, uom: 'cy', costCode: '01' },
    { id: 'po2line', poId: 'po2', poName: 'PO2', name: 'Concrete', quantity: 15, unitCost: 130, uom: 'cy', costCode: '01' },
  ],
};
const input = () => ({ allocations: [{ lineId: 'a', quantity: 5 }], budgets: [{ lineId: 'budget1', change: -626.25 }, { lineId: 'budget2', change: 626.25 }], purchaseOrders: [{ lineId: 'po1line', quantity: 15 }], reason: 'Transfer concrete scope' });

test('checking a group immediately fills quantities; unchecking clears them and preserves budget/PO edits', () => {
  const before = input();
  const checked = toggleSubcontractAllocation(source, before, ['a', 'b', 'missing'], true);
  assert.deepEqual(checked.allocations, [{ lineId: 'a', quantity: 20 }, { lineId: 'b', quantity: 10 }]);
  assert.deepEqual(allocationGroupCheck(source.lines, checked), { checked: true, partial: false });
  assert.equal(allocationTotals(source, checked).subcontract, 2505);
  const cleared = toggleSubcontractAllocation(source, checked, ['a', 'b'], false);
  assert.deepEqual(cleared.allocations, []);
  assert.deepEqual(cleared.budgets, before.budgets);
  assert.deepEqual(cleared.purchaseOrders, before.purchaseOrders);
  assert.deepEqual(allocationGroupCheck(source.lines, cleared), { checked: false, partial: false });
});
test('line toggle changes only that line; partial manual quantities determine the group checkbox after reload', () => {
  const partial = input();
  assert.deepEqual(allocationGroupCheck(source.lines, JSON.parse(JSON.stringify(partial))), { checked: false, partial: true });
  const checked = toggleSubcontractAllocation(source, partial, ['b'], true);
  assert.deepEqual(checked.allocations, [{ lineId: 'a', quantity: 5 }, { lineId: 'b', quantity: 10 }]);
  const cleared = toggleSubcontractAllocation(source, checked, ['b'], false);
  assert.deepEqual(cleared.allocations, partial.allocations);
});

test('unit cost preserves extended item and labor costs and distinguishes missing from zero', () => {
  assert.equal(estimateAllocationUnitCost(10, 100, 50), 15);
  assert.equal(estimateAllocationUnitCost(3, 100, null), 100 / 3);
  assert.equal(estimateAllocationUnitCost(10, 0, 0), 0);
  assert.equal(estimateAllocationUnitCost(10, null, null), null);
  assert.equal(estimateAllocationUnitCost(0, 100, 50), null);
});

test('partial allocation, balanced budget transfer and individual PO quantity changes retain exact identities', () => {
  const changes = validateAllocationChanges(source, input());
  assert.deepEqual(allocationTotals(source, changes), { subcontract: 626.25, budgetChange: 0, poChange: -600 });
  assert.deepEqual(changes.purchaseOrders, [{ lineId: 'po1line', quantity: 15 }]);
  assert.equal(source.poLines[1].quantity, 15);
});
test('full-group quantities and zero-cost lines are valid; missing costs are unavailable', () => {
  const draft = input();
  draft.allocations = source.lines.filter(allocationEligible).map(line => ({ lineId: line.id, quantity: line.quantity }));
  assert.equal(validateAllocationChanges(source, draft).allocations.length, 2);
  assert.equal(allocationTotals(source, draft).subcontract, 2505);
});
test('reject over-allocation, credits, non-finite and excessively precise quantities', () => {
  for (const quantity of [-1, 20.0001, Infinity, NaN, '5', 0.00001, null]) {
    const draft = input(); draft.allocations[0].quantity = quantity;
    assert.throws(() => validateAllocationChanges(source, draft));
  }
});
test('cross-project or removed identities and duplicate rows cannot be saved', () => {
  for (const key of ['allocations', 'budgets', 'purchaseOrders']) {
    const duplicate = input(); duplicate[key].push(duplicate[key][0]);
    assert.throws(() => validateAllocationChanges(source, duplicate));
    const unknown = input(); unknown[key][0].lineId = 'another-project-line';
    assert.throws(() => validateAllocationChanges(source, unknown));
  }
});
test('zeroing PO quantities is distinct from omitting an unchanged line', () => {
  const draft = input(); draft.purchaseOrders = [{ lineId: 'po1line', quantity: 0 }, { lineId: 'po2line', quantity: 15 }];
  assert.deepEqual(validateAllocationChanges(source, draft).purchaseOrders, [{ lineId: 'po1line', quantity: 0 }]);
  assert.equal(allocationTotals(source, draft).poChange, -2400);
});
test('reason is optional; retain existing notes and reject malformed notes', () => {
  for (const reason of ['', ' ', undefined]) {
    const draft = input(); draft.reason = reason;
    assert.equal(validateAllocationChanges(source, draft).reason, '');
  }
  assert.equal(validateAllocationChanges(source, input()).reason, 'Transfer concrete scope');
  for (const reason of [123, null, 'x'.repeat(1001)]) {
    const draft = input(); draft.reason = reason;
    assert.throws(() => validateAllocationChanges(source, draft));
  }
});
test('require valid budget cents and reject negative PO quantities', () => {
  const cents = input(); cents.budgets[0].change = 1.001; assert.throws(() => validateAllocationChanges(source, cents));
  const negative = input(); negative.purchaseOrders[0].quantity = -1; assert.throws(() => validateAllocationChanges(source, negative));
});
test('page and API require commitments permission, including descendants', () => {
  for (const path of ['/procore/commitments-live/allocation', '/api/procore/commitments-live/allocation', '/api/procore/commitments-live/allocation/history']) {
    assert.equal(resolvePermissionForPath(path), 'procore-commitments');
  }
});
test('save protects CSRF, source freshness and optimistic revision; draft and audit share a transaction', () => {
  const route = readFileSync(new URL('../src/app/api/procore/commitments-live/allocation/route.ts', import.meta.url), 'utf8');
  assert.match(route, /validateCsrfRequest/);
  assert.match(route, /getRequestUserEmail/);
  assert.match(route, /input\.fingerprint !== fingerprint/);
  assert.match(route, /prisma\.\$transaction/);
  assert.match(route, /where: \{ \.\.\.key, revision: input\.revision \}/);
  assert.match(route, /tx\.subcontractAllocationRevision\.create/);
  assert.doesNotMatch(route, /makeRequest|commitmentMakerProcoreJson/);
});
