import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWipProjectTeam, selectParadiseProjectManagers } from '../src/lib/wipProjectTeam.ts';
const vendor = { id: 100, name: 'Paradise Masonry, LLC' };
test('Project Team includes only active Paradise PMs, excluding contractor PMs and Paradise estimators', () => {
  const roles = [
    { role: 'Project Manager', user_id: 1 }, { role: 'Project Manager', user_id: 2 },
    { role: 'Estimator', user_id: 3 }, { role: 'Project Manager', user_id: 4, is_active: false },
    { role: 'Project Manager', user_id: 5 }, { role: 'Project Manager', user: { id: 6 } },
    { role: 'Project Manager', user_id: 7 }, { role: 'Project Manager', user_id: 8 },
  ];
  const users = [
    { id: 1, name: 'Abner Stoltzfus', vendor },
    { id: 2, name: 'John Hoffman', vendor: { name: 'Ames Construction, Inc.' } },
    { id: 3, name: 'Isaac Stoltzfus Jr', vendor },
    { id: 4, name: 'Inactive role', vendor },
    { id: 5, name: 'Inactive user', vendor, is_active: false },
    { id: 6, first_name: 'Second', last_name: 'PM', vendor },
    { id: 7, name: 'No employer', email: 'someone@pmcdecor.com' },
    { id: 8, name: 'Lookalike', vendor: { name: 'Paradise Masonry Suppliers' } },
  ];
  assert.deepEqual(selectParadiseProjectManagers(roles, [...users, users[0]]), [{ id: '1', name: 'Abner Stoltzfus' }, { id: '6', name: 'Second PM' }]);
  assert.deepEqual(selectParadiseProjectManagers([], users), []);
});
test('team fetch finishes paginated collections before selecting managers and keeps company/project explicit', async () => {
  const calls = [];
  const snapshot = await fetchWipProjectTeam('company', 'project', async path => {
    calls.push(path);
    if (path.includes('project_roles')) return [{ role: 'Project Manager', user_id: 101 }];
    if (path.includes('page=1&')) return Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'Other', vendor }));
    return [{ id: 101, name: 'PM on page 2', vendor }];
  });
  assert.equal(calls.length, 3);
  assert.match(calls[0], /project_id=project/);
  assert.match(calls[2], /company_id=company&page=2/);
  assert.deepEqual(snapshot.managers, [{ id: '101', name: 'PM on page 2' }]);
  assert.equal(snapshot.companyId, 'company');
});
test('unexpected, failed and truncated responses cannot replace previously saved teams with empty results', async () => {
  await assert.rejects(fetchWipProjectTeam('1', '2', async () => ({ error: 'Denied' })), /Unexpected/);
  await assert.rejects(fetchWipProjectTeam('1', '2', async () => { throw new Error('Rate limit'); }), /Rate limit/);
  await assert.rejects(fetchWipProjectTeam('1', '2', async () => Array.from({ length: 100 }, () => ({}))), /incomplete/);
});
