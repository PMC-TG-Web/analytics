import test from 'node:test';
import assert from 'node:assert/strict';
import { matchQboCustomer } from '../src/lib/qboCustomerMatch.ts';
const evergreen = { id: '9138', name: 'Evergreen Project', fullName: 'Blue Mountain Management Co.:Evergreen Project' };
test('matches unique project name while retaining the full parent customer identity', () => {
  assert.equal(matchQboCustomer(' Evergreen   Project ', [evergreen]), '9138');
  assert.equal(matchQboCustomer('blue mountain management co.:evergreen project', [evergreen]), '9138');
});
test('duplicate names, similar names and missing matches require a choice', () => {
  assert.equal(matchQboCustomer('Evergreen Project', [evergreen, { ...evergreen, id: '99', fullName: 'Another builder:Evergreen Project' }]), null);
  assert.equal(matchQboCustomer('Evergreen', [evergreen]), null);
  assert.equal(matchQboCustomer('', [evergreen]), null);
  assert.equal(matchQboCustomer('Giant #6582', [{ id: '1', name: 'Giant #6583', fullName: 'Builder:Giant #6583' }]), null);
});
