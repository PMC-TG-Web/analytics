import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQboProfitabilityProcoreStatusExport } from '../scripts/lib/qboProfitabilityProcoreStatuses.mjs';

test('builds the canonical Procore status file consumed by the QBO refresh', () => {
  assert.deepEqual(buildQboProfitabilityProcoreStatusExport([
    {
      procoreProjectId: ' 598134326703872 ',
      bidBoardStatus: 'In Progress',
      status: 'Active',
    },
    {
      procoreProjectId: '598134326700001',
      bidBoardStatus: '',
      status: 'Complete',
    },
    {
      procoreProjectId: '598134326700002',
      bidBoardStatus: null,
      status: null,
    },
  ], {
    companyId: '598134325805519',
    generatedAt: '2026-09-02T12:00:00.000Z',
  }), {
    generatedAt: '2026-09-02T12:00:00.000Z',
    companyId: '598134325805519',
    sourceProjectCount: 3,
    exportedProjectCount: 2,
    statuses: ['Complete', 'In Progress'],
    byProjectId: {
      '598134326700001': 'Complete',
      '598134326703872': 'In Progress',
    },
  });
});
