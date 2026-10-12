import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationHours, allocationPercent, buildWipProjects, isWipInProgress, sameWipSource, validateWipAllocations, wipPlanStatus } from '../src/lib/wipPlanning.ts';
import { classifyLaborGroup } from '../src/lib/estimatingDashboardLogic.ts';

const estimate = (overrides = {}) => ({
  bidBoardId: '11', procoreProjectId: '101', selectedProposalId: '22', projectName: 'Project X',
  status: 'In Progress', projectArchived: false, hours: 1200, pmcGroup: { PM: 200, 'Foundation Labor': 1000 },
  customFields: { estimateLineCount: 4 }, ...overrides,
});
const canonical = [{ procoreProjectId: '101', bidBoardId: '11', projectManager: 'PM One' }];

test('WIP starts at In Progress and uses the full selected estimate minus PM', () => {
  for (const status of ['In Progress', 'Inprogress', 'in_progress']) assert.ok(isWipInProgress(status));
  const rows = buildWipProjects([
    estimate(), estimate({ bidBoardId: '12', status: 'Bid Submitted' }),
    estimate({ bidBoardId: '13', status: 'Accepted' }), estimate({ bidBoardId: '14', status: 'Complete' }),
    estimate({ bidBoardId: '15', projectArchived: true }),
  ], canonical);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source.allocatableHours, 1000);
  assert.equal(rows[0].projectManager, 'PM One');
  assert.equal(wipPlanStatus(rows[0]), 'Needs allocation');
  assert.equal(classifyLaborGroup({ name: 'Labor', costCode: '01-300-10-20.L' }), 'PM');
});

test('40/40/20 supports gaps and year boundaries and calculates estimated monthly hours', () => {
  const allocations = validateWipAllocations([{ month: '2027-01', percent: 20 }, { month: '2026-10', percent: 40 }, { month: '2026-11', percent: 40 }]);
  assert.deepEqual(allocations.map(value => value.month), ['2026-10', '2026-11', '2027-01']);
  assert.deepEqual(allocations.map(value => allocationHours(1000, value.percent)), [400, 400, 200]);
  assert.equal(allocationPercent(allocations), 100);
});

test('percentage precision is deterministic and incomplete, duplicate, invalid allocations cannot save', () => {
  assert.equal(allocationPercent(validateWipAllocations([{ month: '2026-10', percent: 33.33 }, { month: '2026-11', percent: 33.33 }, { month: '2027-01', percent: 33.34 }])), 100);
  for (const values of [[], null, [{ month: '2026-10', percent: 99 }], [{ month: '2026-10', percent: 101 }],
    [{ month: '2026-13', percent: 100 }], [{ month: '2026-1', percent: 100 }],
    [{ month: '2026-10', percent: 50 }, { month: '2026-10', percent: 50 }],
    [{ month: '2026-10', percent: -1 }, { month: '2026-11', percent: 101 }],
    [{ month: '2026-10', percent: 33.333 }, { month: '2026-11', percent: 66.667 }],
    [{ month: '2026-10', percent: '100' }], [{ month: '2026-10', percent: NaN }],
    [{ month: '2026-10', percent: Infinity }]]) assert.throws(() => validateWipAllocations(values));
});

test('explicit IDs prevent joining by names or double counting duplicate linked estimates', () => {
  const [linked] = buildWipProjects([estimate({ bidBoardId: '10', hours: 9000 }), estimate()], canonical);
  assert.equal(linked.source.bidBoardId, '11');
  assert.equal(linked.source.allocatableHours, 1000);
  assert.equal(linked.issue, null);
  const [ambiguous] = buildWipProjects([estimate({ bidBoardId: '10' }), estimate({ bidBoardId: '12' })], canonical);
  assert.match(ambiguous.issue, /Multiple estimates/);
  const [unlinked] = buildWipProjects([estimate({ procoreProjectId: null })], canonical);
  assert.equal(unlinked.projectId, null);
  assert.match(unlinked.issue, /Waiting for the linked/);
});

test('missing line data and PM-only estimates cannot masquerade as allocatable jobs', () => {
  for (const change of [{ customFields: { estimateLineCount: 0 } }, { selectedProposalId: null }, { hours: 200 }, { hours: 100 }, { hours: NaN }]) {
    const [row] = buildWipProjects([estimate(change)], canonical);
    assert.ok(row.issue);
    assert.equal(wipPlanStatus(row), 'Needs source review');
  }
});

test('estimate revisions flag review while preserving the saved monthly hours', () => {
  const [row] = buildWipProjects([estimate()], canonical);
  row.plan = { source: { ...row.source }, allocations: [{ month: '2026-10', percent: 100 }] };
  assert.equal(wipPlanStatus(row), 'Allocated');
  row.source = { ...row.source, estimatedHours: 1400, allocatableHours: 1200 };
  assert.equal(wipPlanStatus(row), 'Estimate changed');
  assert.equal(allocationHours(row.plan.source.allocatableHours, row.plan.allocations[0].percent), 1000);
  assert.equal(sameWipSource(row.source, row.plan.source), false);
});
