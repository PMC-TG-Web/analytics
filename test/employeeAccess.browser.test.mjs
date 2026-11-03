import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const enabled = process.env.EMPLOYEE_ACCESS_BROWSER_TEST === '1';
const base = process.env.EMPLOYEE_ACCESS_TEST_URL || 'http://localhost:3000';

async function openFixture({ permissions = ['employees', 'admin'], employeePermissions = ['OWNER'], permissionFailure = false } = {}) {
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'browser tests must stay local');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().addCookies([{ name: 'dev_user_email', value: 'todd@pmcdecor.com', url: base, sameSite: 'Lax' }]);
  const fixture = {
    browser, page, writes: [], alerts: [], unexpectedWrites: [], rejectWrites: false,
    employees: [true, false].map((linked, index) => ({
      id: `employee-${index}`, firstName: linked ? 'Linked' : 'Profile', lastName: 'Person',
      email: `${linked ? 'linked' : 'profile'}@example.test`, jobTitle: 'Field Worker',
      isActive: true, hasLoginAccount: linked, navigationPermissions: linked ? employeePermissions : [],
      notes: 'Keep these profile details', createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z',
    })),
  };
  page.on('dialog', async dialog => { fixture.alerts.push(dialog.message()); await dialog.accept(); });
  // All API requests, including writes, are fixtures. This test never changes saved accounts or employees.
  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!['GET', 'HEAD'].includes(request.method())) {
      if (pathname !== '/api/employees') {
        fixture.unexpectedWrites.push(pathname);
        return route.fulfill({ status: 403, json: { success: false, error: 'Unexpected fixture write' } });
      }
      const body = request.postDataJSON();
      fixture.writes.push({ method: request.method(), body });
      if (fixture.rejectWrites) return route.fulfill({ status: 403, json: { success: false, error: 'Administrator access is required' } });
      return route.fulfill({ json: { success: true, data: { ...body, id: body?.id || 'created-employee', hasLoginAccount: body?.id === 'employee-0' } } });
    }
    if (pathname === '/api/permissions/me') {
      if (permissionFailure) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
      return route.fulfill({ json: { success: true, data: {
        email: 'actor@example.test', permissions, expandedPermissions: ['ADMIN', 'OWNER', 'admin', 'employees'],
      } } });
    }
    if (pathname === '/api/employees') return route.fulfill({ json: { success: true, data: fixture.employees } });
    if (pathname === '/api/job-titles') return route.fulfill({ json: { success: true, data: [{ title: 'Field Worker' }, { title: 'Executive' }] } });
    if (pathname === '/api/permission-templates') return route.fulfill({ json: { success: true, data: { templates: {} } } });
    return route.fulfill({ json: { success: true, data: [] } });
  });
  try {
    const loadedPermissions = page.waitForResponse(response => new URL(response.url()).pathname === '/api/permissions/me');
    await page.goto(`${base}/employees`, { waitUntil: 'domcontentloaded' });
    await loadedPermissions;
    await page.getByRole('heading', { name: 'Employees', exact: true }).waitFor();
    await page.evaluate(() => new Promise(requestAnimationFrame));
    return fixture;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function assertNoAccessFields(body) {
  assert.equal(Object.hasOwn(body, 'navigationPermissions'), false);
  assert.equal(Object.hasOwn(body.customFields || {}, 'navigationPermissions'), false);
  assert.equal(Object.hasOwn(body.customFields || {}, 'NavigationPermissions'), false);
}

test('employee managers can edit profiles without sending access grants, and linked sign-in controls are protected', { skip: !enabled, timeout: 120_000 }, async () => {
  const fixture = await openFixture();
  const { page, browser } = fixture;
  try {
    assert.equal(await page.getByRole('button', { name: 'Manage Access Templates', exact: true }).count(), 0);
    const linkedRow = page.getByRole('row').filter({ hasText: 'Linked Person' });
    assert.equal(await linkedRow.getByRole('button', { name: 'Active', exact: true }).isDisabled(), true);
    assert.equal(await linkedRow.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), true);
    await linkedRow.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.getByPlaceholder('john.doe@pmcdecor.com').isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Template', exact: true }).count(), 0);
    assert.equal(await page.getByText('Navigation Permissions', { exact: true }).count(), 0);
    await page.getByPlaceholder('John', { exact: true }).fill('Updated');
    await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
    assertNoAccessFields(fixture.writes.at(-1).body);
    assert.equal(fixture.writes.at(-1).body.customFields.notes, 'Keep these profile details');

    const profileRow = page.getByRole('row').filter({ hasText: 'Profile Person' });
    await profileRow.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.getByPlaceholder('john.doe@pmcdecor.com').isDisabled(), false);
    const editor = page.getByRole('heading', { name: 'Edit Employee', exact: true }).locator('..');
    await editor.locator('select').first().selectOption('Executive');
    await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
    assertNoAccessFields(fixture.writes.at(-1).body);
    assert.equal(fixture.writes.at(-1).body.jobTitle, 'Executive');
    await profileRow.getByRole('button', { name: 'Active', exact: true }).click();
    await profileRow.waitFor({ state: 'hidden' });
    assert.deepEqual(fixture.writes.at(-1).body, { id: 'employee-1', isActive: false });

    await page.getByRole('button', { name: 'Add Employee', exact: true }).click();
    await page.getByPlaceholder('John', { exact: true }).fill('New');
    await page.getByPlaceholder('Doe', { exact: true }).fill('Person');
    const addEditor = page.getByRole('heading', { name: 'Add New Employee', exact: true }).locator('..');
    await addEditor.getByRole('button', { name: 'Add Employee', exact: true }).click();
    await page.getByRole('heading', { name: 'Add New Employee', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(fixture.writes.at(-1).method, 'POST');
    assertNoAccessFields(fixture.writes.at(-1).body);
    assert.deepEqual(fixture.unexpectedWrites, []);
  } finally {
    await browser.close();
  }
});

for (const role of ['ADMIN', 'OWNER']) {
  test(`${role} can edit page access without job titles or templates removing their administrative role`, { skip: !enabled, timeout: 120_000 }, async () => {
    const { browser, page, writes, unexpectedWrites } = await openFixture({ permissions: [role], employeePermissions: [role] });
    try {
      await page.getByRole('button', { name: 'Manage Access Templates', exact: true }).click();
      await page.getByRole('heading', { name: 'Job Title Access Templates', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      const row = page.getByRole('row').filter({ hasText: 'Linked Person' });
      assert.equal(await row.getByRole('button', { name: 'Delete', exact: true }).isDisabled(), false);
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(await page.getByPlaceholder('john.doe@pmcdecor.com').isDisabled(), false);
      const editor = page.getByRole('heading', { name: 'Edit Employee', exact: true }).locator('..');
      await editor.locator('select').first().selectOption('Executive');
      await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
      assertNoAccessFields(writes.at(-1).body);
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('button', { name: 'Template', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Employees', exact: true }).check();
      await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
      assert.ok(writes.at(-1).body.navigationPermissions.includes('employees'));
      assert.ok(writes.at(-1).body.navigationPermissions.includes(role), 'applying a page template preserves the assigned administrative role');
      assert.deepEqual(writes.at(-1).body.navigationPermissions, writes.at(-1).body.customFields.navigationPermissions);
      await row.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByPlaceholder('(555) 123-4567').fill('5551234567');
      await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
      await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
      assertNoAccessFields(writes.at(-1).body);
      assert.deepEqual(unexpectedWrites, []);
    } finally {
      await browser.close();
    }
  });
}

test('administrator can grant and revoke Billing Analytics separately from Analytics', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page, writes, unexpectedWrites } = await openFixture({ permissions: ['OWNER'], employeePermissions: ['analytics'] });
  try {
    const row = page.getByRole('row').filter({ hasText: 'Linked Person' });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const billing = page.getByRole('checkbox', { name: 'Billing Analytics', exact: true });
    const analytics = page.getByRole('checkbox', { name: 'Analytics', exact: true });
    assert.equal(await billing.isChecked(), false);
    assert.equal(await analytics.isChecked(), true);
    await billing.check();
    await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(writes.at(-1).body.navigationPermissions, ['analytics', 'page:/accounting/billing-analytics']);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await billing.isChecked(), true);
    await billing.uncheck();
    await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
    assert.ok(writes.at(-1).body.navigationPermissions.includes('!page:/accounting/billing-analytics'));
    assert.ok(writes.at(-1).body.navigationPermissions.includes('analytics'));
    assert.deepEqual(unexpectedWrites, []);
  } finally {
    await browser.close();
  }
});

test('separate main pages are independently selectable in employee and template pickers with search', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page, writes, unexpectedWrites } = await openFixture({ permissions: ['OWNER'], employeePermissions: ['analytics'] });
  try {
    await page.getByRole('row').filter({ hasText: 'Linked Person' }).getByRole('button', { name: 'Edit', exact: true }).click();
    for (const name of ['Financial WIP', 'Market Outlook', 'Commitment Maker', 'Open Changes', 'Billing Analytics']) {
      assert.equal(await page.getByRole('checkbox', { name, exact: true }).count(), 1, name);
    }
    assert.equal(await page.getByRole('checkbox', { name: 'Login', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Home', exact: true }).isDisabled(), true);
    const search = page.getByRole('searchbox', { name: 'Search navigation permissions' });
    await search.fill('Financial WIP');
    await page.getByRole('checkbox', { name: 'Financial WIP', exact: true }).uncheck();
    await search.fill('');
    assert.equal(await page.getByRole('checkbox', { name: 'Analytics', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Market Outlook', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Financial WIP', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: 'Commitment Maker', exact: true }).check();
    await search.fill('billing');
    if (process.env.PAGE_CATALOG_SCREENSHOT) await search.locator('..').screenshot({ path: process.env.PAGE_CATALOG_SCREENSHOT });
    await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
    assert.ok(writes.at(-1).body.navigationPermissions.includes('analytics'));
    assert.ok(writes.at(-1).body.navigationPermissions.includes('!page:/analytics/monthly-hours'));
    assert.ok(writes.at(-1).body.navigationPermissions.includes('page:/procore/commitments-live/maker'));
    await page.getByRole('row').filter({ hasText: 'Linked Person' }).getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'Financial WIP', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: 'Market Outlook', exact: true }).isChecked(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Commitments', exact: true }).isChecked(), false);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Manage Access Templates', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search navigation permissions' }).fill('/procore/commitments-live/maker');
    assert.equal(await page.getByRole('checkbox', { name: 'Commitment Maker', exact: true }).count(), 1);
    assert.deepEqual(unexpectedWrites, []);
  } finally { await browser.close(); }
});

test('main pages automatically include Help and supporting views in employee and template pickers', { skip: !enabled, timeout: 120_000 }, async () => {
  const { browser, page, writes, unexpectedWrites } = await openFixture({ permissions: ['OWNER'], employeePermissions: ['!page:/help/billing-analytics'] });
  try {
    const row = page.getByRole('row').filter({ hasText: 'Linked Person' });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const billing = page.getByRole('checkbox', { name: 'Billing Analytics', exact: true });
    const help = page.getByRole('checkbox', { name: 'Help: Billing analytics', exact: true });
    assert.equal(await help.isChecked(), false);
    assert.equal(await help.isDisabled(), false);
    await billing.check();
    assert.equal(await help.isChecked(), true);
    assert.equal(await help.isDisabled(), true);
    assert.equal(await help.locator('..').getByText('Included with Billing Analytics.', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit Employee', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(writes.at(-1).body.navigationPermissions, ['!page:/help/billing-analytics', 'page:/accounting/billing-analytics']);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await help.isChecked(), true);
    assert.equal(await help.isDisabled(), true);
    const search = page.getByRole('searchbox', { name: 'Search navigation permissions' });
    await search.fill('billing');
    if (process.env.SUPPORTING_PAGES_SCREENSHOT) await search.locator('..').screenshot({ path: process.env.SUPPORTING_PAGES_SCREENSHOT });
    await billing.uncheck();
    assert.equal(await help.isChecked(), false);
    assert.equal(await help.isDisabled(), false);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Manage Access Templates', exact: true }).click();
    await page.getByRole('checkbox', { name: 'My Work', exact: true }).check();
    for (const name of ['Open Changes', 'Help: My Work', 'Help: Open Changes']) {
      const support = page.getByRole('checkbox', { name, exact: true });
      assert.equal(await support.isChecked(), true, name);
      assert.equal(await support.isDisabled(), true, name);
    }
    assert.deepEqual(unexpectedWrites, []);
  } finally { await browser.close(); }
});

test('failed permission lookup hides access controls and rejected saves remain visibly unsaved', { skip: !enabled, timeout: 120_000 }, async () => {
  const fixture = await openFixture({ permissionFailure: true });
  const { browser, page } = fixture;
  try {
    assert.equal(await page.getByRole('button', { name: 'Manage Access Templates', exact: true }).count(), 0);
    await page.getByRole('row').filter({ hasText: 'Linked Person' }).getByRole('button', { name: 'Edit', exact: true }).click();
    fixture.rejectWrites = true;
    await page.getByPlaceholder('John', { exact: true }).fill('Rejected');
    const rejection = page.waitForEvent('dialog');
    await page.getByRole('button', { name: 'Update Employee', exact: true }).click();
    await rejection;
    assert.equal(await page.getByRole('heading', { name: 'Edit Employee', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('row').filter({ hasText: 'Linked Person' }).count(), 1);
    assert.ok(fixture.alerts.includes('Administrator access is required'));
    assertNoAccessFields(fixture.writes.at(-1).body);
  } finally {
    await browser.close();
  }
});
