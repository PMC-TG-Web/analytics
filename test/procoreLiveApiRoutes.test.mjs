import assert from 'node:assert/strict';
import test from 'node:test';

import { isProcoreLiveApiRoutePath } from '../src/lib/procoreLiveApiRoutes.ts';

test('does not apply the live Procore gate to the database-backed project list', () => {
  assert.equal(isProcoreLiveApiRoutePath('/api/procore/projects'), false);
});

test('continues to gate Procore-backed project and sync routes', () => {
  assert.equal(isProcoreLiveApiRoutePath('/api/procore/projects/123/vendors'), true);
  assert.equal(isProcoreLiveApiRoutePath('/api/procore/sync/all-projects'), true);
  assert.equal(isProcoreLiveApiRoutePath('/api/projects'), false);
});
