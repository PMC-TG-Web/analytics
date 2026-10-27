import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const enabled = process.env.PAGE_LOOKUPS_BROWSER_TEST === '1';
const base = process.env.PAGE_LOOKUPS_TEST_URL || 'http://localhost:3000';

async function fixture(run) {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [], writes = [], errors = [];
  let failLookups = false;
  await page.context().addCookies([{ name: 'dev_user_email', value: 'todd@pmcdecor.com', url: base }]);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    requests.push(pathname);
    if (pathname.startsWith('/api/auth/')) return route.fulfill({ json: { user: { email: 'todd@pmcdecor.com' } } });
    if (request.method() !== 'GET') { writes.push(pathname); return route.fulfill({ status: 403, json: { success: false } }); }
    if (pathname === '/api/permissions/me') return route.fulfill({ json: { success: true, data: {
      email: 'todd@pmcdecor.com', permissions: ['crew-management', 'estimating-tools', 'certifications'],
    } } });
    if (failLookups && /\/api\/(crew-management|estimating-tools|certifications)\//.test(pathname)) {
      return route.fulfill({ status: 503, json: { success: false } });
    }
    const data = {
      '/api/crew-management/employees': [
        { id: 'foreman-1', firstName: 'Test', lastName: 'Foreman', jobTitle: 'Foreman', isActive: true },
        { id: 'laborer-1', firstName: 'Test', lastName: 'Laborer', jobTitle: 'Laborer', isActive: true },
      ],
      '/api/crew-templates': [],
      '/api/estimating-tools/projects': [
        { id: 'local-project-1', projectName: 'Shared project name', projectNumber: '1', customer: 'Test customer' },
        { id: 'local-project-2', projectName: 'Shared project name', projectNumber: '1', customer: 'Test customer' },
      ],
      '/api/estimating-constants': [],
      '/api/certifications/employees': [{ id: 'employee-1', firstName: 'Alex', lastName: 'Example' }],
      '/api/certifications/expiration-review': [
        { id: 'cert-1', employeeId: 'employee-1', employeeName: 'Alex Example', type: 'Expired credential', expirationDate: '2020-01-01' },
        { id: 'cert-2', employeeId: 'employee-1', employeeName: 'Alex Example', type: 'Future credential', expirationDate: '2099-01-01' },
        { id: 'cert-3', employeeId: 'employee-1', employeeName: 'Alex Example', type: 'Undated credential', expirationDate: '' },
      ],
    };
    if (pathname in data) return route.fulfill({ json: { success: true, data: data[pathname] } });
    return route.fulfill({ status: 403, json: { success: false, error: 'Fixture denied unexpected endpoint' } });
  });
  try {
    await run({ page, requests, fail: () => { failLookups = true; } });
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    assert.equal(requests.includes('/api/employees'), false);
    assert.equal(requests.includes('/api/projects'), false);
    assert.equal(requests.includes('/api/check-certifications'), false);
  } finally { await browser.close(); }
}

test('crew and estimating selectors use page lookups and preserve distinct project IDs', { skip: !enabled }, async () => {
  await fixture(async ({ page, requests }) => {
    await page.goto(`${base}/crew-management`);
    await page.getByText('Test Foreman', { exact: true }).first().waitFor();
    assert.ok(requests.includes('/api/crew-management/employees'));
    await page.goto(`${base}/estimating-tools`);
    await page.locator('option[value="local-project-2"]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('option[value^="local-project-"]').count(), 2);
  });
});

test('certification review shows expired/missing dates, supports name search and reports refresh failures', { skip: !enabled }, async () => {
  await fixture(async ({ page, requests, fail }) => {
    await page.goto(`${base}/certifications`);
    const search = page.getByPlaceholder('Search employee or certification type...');
    await search.fill('Alex');
    await page.getByText('Future credential', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Review Expirations', exact: true }).click();
    await page.getByText('1 expired; 0 due within 90 days; 1 missing or invalid dates.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Future credential', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Undated credential', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Expired credential', { exact: true }).count(), 1);
    assert.ok(requests.filter(p => p === '/api/certifications/expiration-review').length >= 2);
    fail();
    await page.getByRole('button', { name: 'Review Expirations', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Unable to refresh certifications' }).waitFor();
    await page.getByText('Review could not be refreshed. Please try again.', { exact: true }).waitFor();
  });
});
