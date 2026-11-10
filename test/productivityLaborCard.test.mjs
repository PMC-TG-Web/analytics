import test from 'node:test';
import assert from 'node:assert/strict';
import { projectsWithPurchaseOrderLabor } from '../src/lib/productivityLaborCard.ts';

test('PO labor hides only its own project labor card, regardless of quantity or status', () => {
  const projects = projectsWithPurchaseOrderLabor([
    { projectId: 'witmer', costType: 'Labor', expectedQuantity: 253, poStatus: 'Approved' },
    { projectId: 'witmer', costType: 'Labor', expectedQuantity: 1391, poStatus: 'Approved' },
    { projectId: 'draft', costType: ' l ', expectedQuantity: 0, poStatus: 'Draft' },
    { projectId: 'legacy', costType: 'LABOUR' },
    { projectId: 'materials-only', costType: 'Materials', description: 'Labor supplies' },
    { projectId: 'equipment', costType: 'Equipment', uom: 'hours' },
    { projectId: 'unknown', costType: null },
  ]);
  assert.deepEqual([...projects], ['witmer', 'draft', 'legacy']);
  assert.equal(projects.has('labor-only'), false);
  assert.equal(projectsWithPurchaseOrderLabor([]).size, 0);
});
