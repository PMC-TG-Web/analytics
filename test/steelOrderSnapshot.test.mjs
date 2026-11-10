import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteelOrderSnapshot, verifySteelOrderSnapshot } from '../src/lib/steelOrderSnapshot.ts';

const secret = 'fixture-only-signing-key';
const now = Date.parse('2026-11-10T12:00:00Z');
const input = { projectId: '101', itemKey: '["#4 Rebar - 20\u0027 Pc","EA"]', quantity: 123.5 };
test('order snapshots bind company, project, normalized material/unit and displayed quantity', () => {
  const token = createSteelOrderSnapshot('company', input, secret, now);
  assert.equal(verifySteelOrderSnapshot(token, 'company', input, secret, now), true);
  for (const [company, value] of [['other', input], ['company', { ...input, projectId: '102' }], ['company', { ...input, itemKey: 'wire' }], ['company', { ...input, quantity: 124 }]]) {
    assert.equal(verifySteelOrderSnapshot(token, company, value, secret, now), false);
  }
  assert.equal(verifySteelOrderSnapshot(token, 'company', input, 'wrong-key', now), false);
  // Ordered state and revision are still verified separately against the saved mark.
  assert.equal(verifySteelOrderSnapshot(token, 'company', { ...input, ordered: false, revision: 5 }, secret, now), true);
});
test('snapshots reject expired, forged and missing proofs and fail closed without a key', () => {
  const token = createSteelOrderSnapshot('company', input, secret, now);
  const lifetime = 24 * 60 * 60 * 1000;
  assert.equal(verifySteelOrderSnapshot(token, 'company', input, secret, now + lifetime - 1), true);
  assert.equal(verifySteelOrderSnapshot(token, 'company', input, secret, now + lifetime), false);
  for (const invalid of [undefined, null, '', {}, 'not-a-proof', token.replace(/^\d+/, String(now + lifetime + 1)), token.split('.')[0] + '.' + 'A'.repeat(43)]) {
    assert.equal(verifySteelOrderSnapshot(invalid, 'company', input, secret, now), false);
  }
  assert.throws(() => createSteelOrderSnapshot('company', input, '', now));
  assert.throws(() => verifySteelOrderSnapshot(token, 'company', input, '', now));
});
