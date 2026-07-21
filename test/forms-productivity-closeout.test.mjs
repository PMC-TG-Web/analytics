import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyFormsCloseoutLine,
  classifyProjectManagementCloseoutLine,
  formsCloseoutMarker,
  hasFormsCloseoutMarker,
} from '../src/lib/formsProductivityCloseout.ts';

const base = {
  poStatus: 'Approved',
  costCode: '03-100-30-20',
  description: 'Site Concrete Wood Forms - SOG',
  uom: 'SF',
  expectedQuantity: 200,
  usedQuantity: 0,
};

test('an untracked SOG forms line is ready for its full expected quantity', () => {
  const result = classifyFormsCloseoutLine(base);
  assert.equal(result.disposition, 'ready');
  assert.equal(result.remainingQuantity, 200);
});

test('a partially tracked forms line adds only the missing quantity', () => {
  const result = classifyFormsCloseoutLine({ ...base, usedQuantity: 30 });
  assert.equal(result.disposition, 'ready');
  assert.equal(result.remainingQuantity, 170);
});

test('a fully tracked or over-used forms line is not changed', () => {
  assert.equal(classifyFormsCloseoutLine({ ...base, usedQuantity: 200 }).disposition, 'complete');
  assert.equal(classifyFormsCloseoutLine({ ...base, usedQuantity: 220 }).disposition, 'complete');
});

test('form release and non-SF records require review', () => {
  assert.equal(
    classifyFormsCloseoutLine({ ...base, description: 'TK Gold Form Release - Wall' }).disposition,
    'review'
  );
  assert.equal(classifyFormsCloseoutLine({ ...base, uom: 'EA' }).disposition, 'review');
});

test('the closeout note marker is stable and detectable', () => {
  const marker = formsCloseoutMarker('123');
  assert.equal(hasFormsCloseoutMarker(`Administrative entry ${marker}`), true);
  assert.equal(hasFormsCloseoutMarker('ordinary field log'), false);
});

test('an approved Management line on the configured code is ready in EA', () => {
  const result = classifyProjectManagementCloseoutLine({
    poStatus: 'Approved',
    costCode: '01-300-10-20',
    description: 'Management',
    uom: 'ea',
    expectedQuantity: 35,
    usedQuantity: 5,
  });
  assert.equal(result.disposition, 'ready');
  assert.equal(result.remainingQuantity, 30);
});

test('Project Management matching rejects adjacent labor lines', () => {
  assert.equal(classifyProjectManagementCloseoutLine({
    poStatus: 'Approved',
    costCode: '01-300-10-20',
    description: 'Superintendent',
    uom: 'ea',
    expectedQuantity: 10,
    usedQuantity: 0,
  }).disposition, 'review');
});
