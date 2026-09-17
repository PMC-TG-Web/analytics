import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyLogIssueUrl, purchaseOrderIssueUrl } from '../src/lib/qboIssueLinks.ts';

test('PO links use the exact company, project and external PO identity', () => {
  assert.equal(purchaseOrderIssueUrl('598134325805519', '598134326663255', '598134328428887'), 'https://us02.procore.com/webclients/host/companies/598134325805519/projects/598134326663255/tools/contracts/commitments/purchase_order_contracts/598134328428887');
  assert.equal(purchaseOrderIssueUrl('1', '2', '3'), 'https://us02.procore.com/webclients/host/companies/1/projects/2/tools/contracts/commitments/purchase_order_contracts/3');
  for (const args of [['1', '2', ''], ['1', '2', '../3'], ['1', '2', 'PO-002'], ['x', '2', '3'], ['1', 'x', '3']]) assert.equal(purchaseOrderIssueUrl(...args), null);
});

test('uses the supplied Procore format with each issue project and calendar date', () => {
  assert.equal(dailyLogIssueUrl('598134325805519', '598134326663255', '2026-09-14'), 'https://us02.procore.com/webclients/host/companies/598134325805519/projects/598134326663255/tools/dailylog/list?date=2026-09-14');
  assert.equal(dailyLogIssueUrl('1', '2', '2026-09-09'), 'https://us02.procore.com/webclients/host/companies/1/projects/2/tools/dailylog/list?date=2026-09-09');
  for (const args of [['1', '../2', '2026-09-09'], ['x', '2', '2026-09-09'], ['1', '2', '2026-02-30'], ['1', '2', '2026-13-01'], ['1', '2', '']]) assert.equal(dailyLogIssueUrl(...args), null);
});
