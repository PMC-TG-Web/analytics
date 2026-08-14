import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmbeddedDrillthroughProjects,
  mergeSnapshotSummary,
} from '../scripts/lib/qboProfitabilityDrillthrough.mjs';

test('indexes drill-through details by QBO customer id', () => {
  const projects = buildEmbeddedDrillthroughProjects({
    projects: [{
      qboCustomerId: ' 7353 ',
      projectName: 'Greenfield North Apartments 2.0',
      status: 'available',
      total: '125.50',
      breakdown: [{ section: 'Cost of Goods Sold', amount: 125.5 }],
      lines: [{ amount: 125.5 }],
      billing: {
        billed: 1000,
        netBilled: 900,
        activity: [{ txnType: 'Credit Memo', amount: -100 }],
      },
    }],
  });

  assert.deepEqual(projects['7353'], {
    status: 'available',
    total: 125.5,
    lineCount: 1,
    projectName: 'Greenfield North Apartments 2.0',
    fullyQualifiedName: null,
    breakdown: [{ section: 'Cost of Goods Sold', amount: 125.5 }],
    lines: [{ amount: 125.5 }],
    billing: {
      billed: 1000,
      netBilled: 900,
      activity: [{ txnType: 'Credit Memo', amount: -100 }],
    },
  });
});

test('merges drill-through details without removing snapshot totals', () => {
  const projects = { 7353: { lineCount: 1, lines: [{ amount: 125.5 }] } };
  assert.deepEqual(mergeSnapshotSummary({ projectRows: 214 }, projects), {
    projectRows: 214,
    qboCostDrillthroughProjects: projects,
  });
});

test('returns no embedded map when no valid project key is present', () => {
  assert.equal(buildEmbeddedDrillthroughProjects({ projects: [{ projectName: 'Unknown' }] }), null);
});
