import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_JOB_COST_URL,
  DEFAULT_TEST_PROJECT_ID,
  filterPendingJobs,
  parseArgs,
  queuedIdsFromJsonl,
} from '../scripts/syncProcoreJobCostsBrowser.mjs';

test('job-cost sync options apply safe production defaults', () => {
  const options = parseArgs([], { LOCALAPPDATA: 'C:\\Local' });
  assert.equal(options.delaySeconds, 15);
  assert.equal(options.jobCostUrl, DEFAULT_JOB_COST_URL);
  assert.equal(options.includeTest, false);
  assert.equal(options.dryRun, false);
  assert.match(options.profileDir, /ProcoreJobCostBrowserProfile$/);
});

test('job-cost sync options accept delay, skip, resume, and dry-run', () => {
  const options = parseArgs([
    '--delay=7.5', '--skip', 'Example Project', '--resume=logs\\prior.jsonl',
    '--dry-run', '--include-test',
  ]);
  assert.equal(options.delaySeconds, 7.5);
  assert.deepEqual(options.skips, ['Example Project']);
  assert.match(options.resumePath, /prior\.jsonl$/);
  assert.equal(options.dryRun, true);
  assert.equal(options.includeTest, true);
});

test('job-cost sync options reject unsafe or unrelated URLs', () => {
  assert.throws(() => parseArgs(['--url', 'http://us02.procore.com/company/erp_integrations/job_costs']), /HTTPS/);
  assert.throws(() => parseArgs(['--url', 'https://example.com/company/erp_integrations/job_costs']), /procore\.com/);
  assert.throws(() => parseArgs(['--url', 'https://us02.procore.com/projects']), /Job Costs/);
});

test('resume parsing extracts confirmed and accepted-without-banner projects', () => {
  const ids = queuedIdsFromJsonl([
    JSON.stringify({ event: 'queued', jobId: 'one' }),
    JSON.stringify({ event: 'error', jobId: 'two' }),
    JSON.stringify({ event: 'accepted_unconfirmed', jobId: 'two' }),
    '',
  ].join('\n'));
  assert.deepEqual([...ids], ['one', 'two']);
  assert.throws(() => queuedIdsFromJsonl('{not json}'), /line 1/);
});

test('pending jobs exclude the test project, explicit skips, and resumed IDs', () => {
  const jobs = [
    { id: DEFAULT_TEST_PROJECT_ID, name: 'TAD-001 - ToddandDave cost code test' },
    { id: 'one', name: 'First Project' },
    { id: 'two', name: 'Second Project' },
    { id: 'three', name: 'Third Project' },
  ];
  assert.deepEqual(
    filterPendingJobs(jobs, { includeTest: false, skips: ['Second Project'] }, new Set(['three'])),
    [{ id: 'one', name: 'First Project' }],
  );
  assert.deepEqual(filterPendingJobs(jobs, { includeTest: true, skips: [] }), jobs);
});
