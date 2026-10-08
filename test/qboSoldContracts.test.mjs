import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateQboSoldContractValue } from '../src/lib/financialWip.ts';

test('Accepted bids are excluded from QBO Sold count and dollars despite an In Progress execution badge', () => {
  const projects = [
    { procoreProjectNumber: '2604', contractDate: '2026-09-10', bidBoardStatus: ' Accepted ', procoreStatus: 'In Progress', contractValue: 226675.54 },
    { procoreProjectNumber: '2501', contractDate: '2026-01-01', bidBoardStatus: 'In Progress', contractValue: 100 },
    { procoreProjectNumber: '2601', contractDate: '2026-02-01', bidBoardStatus: 'Complete', contractValue: 200 },
    { procoreProjectNumber: '2602', contractDate: '2025-12-31', bidBoardStatus: 'In Progress', contractValue: 900 },
  ];
  assert.deepEqual(calculateQboSoldContractValue(projects, 2026), {
    year: 2026, projectCount: 2, contractProjectCount: 2, contractValue: 300,
  });
  assert.equal(projects.length, 4, 'accounting table rows remain intact');
  assert.equal(calculateQboSoldContractValue([{ ...projects[0], bidBoardStatus: 'ACCEPTED' }], 2026).projectCount, 0);
});

test('QBO Sold preserves date fallbacks, unknown statuses, and missing versus zero contract values', () => {
  assert.deepEqual(calculateQboSoldContractValue([
    { procoreProjectNumber: '2601', bidBoardStatus: null, contractValue: null },
    { procoreProjectNumber: 'NO-YEAR', startDate: '2026-02-01', bidBoardStatus: 'Complete', contractValue: 0 },
    { procoreProjectNumber: '2603', bidBoardStatus: 'Accepted', contractValue: null },
  ], 2026), { year: 2026, projectCount: 2, contractProjectCount: 1, contractValue: 0 });
});

test('QBO route supplies current estimating status to Sold calculation without filtering accounting rows', () => {
  const source = readFileSync(new URL('../src/app/api/accounting/project-profitability/route.ts', import.meta.url), 'utf8');
  assert.match(source, /bidBoardStatus: project\.status \|\| null/);
  assert.match(source, /const soldContracts = calculateQboSoldContractValue\(/);
  assert.match(source, /bidBoardStatus: row\.procoreProjectId \? procoreContracts\.get\(row\.procoreProjectId\)\?\.bidBoardStatus : null/);
  assert.match(source, /const responseRows = rows\.map\(/);
});
