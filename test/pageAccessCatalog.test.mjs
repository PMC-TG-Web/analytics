import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverAppPages, generateAppPageInventory, pageRouteFromFile, watchAppPageInventory } from '../scripts/lib/appPageInventory.mjs';
import { APP_PAGES } from '../src/lib/generated/appPages.js';
import { resolveDiscoveredPagePermission } from '../src/lib/appPagePolicy.js';
import { buildPageAccessCatalog, filterPageAccessCatalog, includedPageParents, PAGE_ACCESS_CATALOG } from '../src/lib/pageAccessCatalog.ts';
import { expandAssignedPermissions, NAVIGATION_PERMISSION_OPTIONS } from '../src/lib/permissions.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';
import { HELP_GUIDE_SUMMARIES } from '../src/lib/helpGuides/catalog.ts';
import { pagePermission, updateIndependentPagePermission, apiPagePermissions, SUPPORTING_PAGE_PARENTS, PAGE_PATHS } from '../src/lib/independentPagePermissions.js';
import { createPermissionCookieValue, verifyPermissionCookieValue } from '../src/lib/permissionCookie.ts';

test('every app page and help guide appears in the generated access catalog', () => {
  assert.deepEqual(APP_PAGES, discoverAppPages(fileURLToPath(new URL('../src/app', import.meta.url))));
  assert.ok(APP_PAGES.length > 50);
  assert.equal(new Set(PAGE_ACCESS_CATALOG.map(entry => entry.id)).size, PAGE_ACCESS_CATALOG.length);
  for (const page of APP_PAGES) {
    const paths = page.pathname === '/help/[slug]' ? HELP_GUIDE_SUMMARIES.map(g => `/help/${g.slug}`) : [page.pathname];
    for (const path of paths) {
      const entry = PAGE_ACCESS_CATALOG.find(entry => entry.path === path);
      assert.ok(entry, path);
      if (entry.permission) {
        assert.equal(entry.permission, pagePermission(path));
        assert.ok(NAVIGATION_PERMISSION_OPTIONS.includes(entry.permission), path);
      } else assert.equal(entry.section, 'System and redirected pages');
    }
  }
  for (const path of ['/market-outlook', '/analytics/monthly-hours', '/procore/commitments-live/maker', '/pm-dashboard/changes']) {
    assert.ok(PAGE_ACCESS_CATALOG.find(entry => entry.path === path)?.permission, path);
  }
});

test('each page has its own control while private restrictions and redirects remain explicit', () => {
  const find = path => PAGE_ACCESS_CATALOG.find(entry => entry.path === path);
  assert.equal(find('/analytics/monthly-hours').permission, 'page:/analytics/monthly-hours');
  assert.equal(find('/market-outlook').permission, 'page:/market-outlook');
  assert.notEqual(find('/market-outlook').permission, find('/analytics/monthly-hours').permission);
  assert.match(find('/procore/commitments-live/allocation').note, /Todd-only/);
  assert.equal(find('/scheduling').permission, null);
  assert.match(find('/scheduling').note, /Opens WIP/);
  for (const path of ['/', '/help', '/login', '/forbidden', '/auth/start', '/auth/complete', '/auth/logout-complete']) assert.equal(find(path).permission, null);
  assert.equal(find('/accounting/billing-analytics').permission, 'page:/accounting/billing-analytics');
  assert.ok(filterPageAccessCatalog('Financial WIP').some(entry => entry.path === '/analytics/monthly-hours'));
  assert.ok(filterPageAccessCatalog('/procore/commitments-live/maker').some(entry => entry.label === 'Commitment Maker'));
});

test('granting or revoking main pages preserves other main pages and administrative roles', () => {
  const entries = PAGE_ACCESS_CATALOG.filter(entry => entry.permission && !entry.parentPaths.length);
  assert.equal(new Set(entries.map(entry => entry.permission)).size, entries.length);
  for (const starting of [[], ['analytics'], ['OWNER'], ['ADMIN']]) {
    const before = expandAssignedPermissions(starting);
    for (const entry of entries) {
      const enabled = !before.includes(entry.permission);
      const updated = updateIndependentPagePermission(starting, entry.path, enabled);
      const after = expandAssignedPermissions(updated);
      assert.equal(after.includes(entry.permission), enabled, entry.path);
      for (const other of entries.filter(other => other !== entry)) {
        assert.equal(after.includes(other.permission), before.includes(other.permission), `${entry.path} must not change ${other.path}`);
      }
      for (const role of starting.filter(role => ['ADMIN', 'OWNER'].includes(role))) assert.ok(updated.includes(role));
    }
  }
});

test('every Help guide and declared supporting view is included with its main page', () => {
  for (const guide of HELP_GUIDE_SUMMARIES) {
    assert.deepEqual(SUPPORTING_PAGE_PARENTS[`/help/${guide.slug}`], [guide.pagePath]);
  }
  for (const [child, parents] of Object.entries(SUPPORTING_PAGE_PARENTS)) {
    assert.ok(PAGE_PATHS.includes(child), child);
    for (const parent of parents) {
      assert.ok(PAGE_PATHS.includes(parent), parent);
      const effective = expandAssignedPermissions([pagePermission(parent), `!${pagePermission(child)}`]);
      assert.ok(effective.includes(pagePermission(child)), `${parent} includes ${child}, despite an older separate denial`);
      const entry = PAGE_ACCESS_CATALOG.find(entry => entry.path === child);
      if (entry.permission) assert.ok(includedPageParents(entry, effective).length > 0, child);
    }
  }
  const visit = (path, ancestors = []) => {
    assert.ok(!ancestors.includes(path), `cyclic supporting-page relationship: ${[...ancestors, path]}`);
    for (const parent of SUPPORTING_PAGE_PARENTS[path] || []) visit(parent, [...ancestors, path]);
  };
  for (const path of Object.keys(SUPPORTING_PAGE_PARENTS)) visit(path);
});

test('supporting access is transitive, reversible, and preserves separately selected pages', () => {
  const selected = ['page:/analytics', '!page:/analytics/productivity', '!page:/help/field-productivity'];
  const effective = expandAssignedPermissions(selected);
  assert.ok(effective.includes('page:/analytics/productivity'));
  const productivityHelp = HELP_GUIDE_SUMMARIES.find(guide => guide.pagePath === '/analytics/productivity');
  assert.ok(effective.includes(pagePermission(`/help/${productivityHelp.slug}`)));
  for (const path of ['/analytics/monthly-hours', '/market-outlook', '/accounting/billing-analytics', '/procore/commitments-live/allocation']) {
    assert.ok(!effective.includes(pagePermission(path)), `Analytics does not include ${path}`);
  }
  const revoked = expandAssignedPermissions(updateIndependentPagePermission(selected, '/analytics', false));
  assert.ok(!revoked.includes('page:/analytics/productivity'));
  assert.ok(!revoked.includes(pagePermission(`/help/${productivityHelp.slug}`)));
  const standalone = ['page:/pm-dashboard', 'page:/pm-dashboard/changes'];
  const withoutMain = expandAssignedPermissions(updateIndependentPagePermission(standalone, '/pm-dashboard', false));
  assert.ok(withoutMain.includes('page:/pm-dashboard/changes'));
  assert.ok(!withoutMain.includes('page:/pm-dashboard'));
  assert.deepEqual(includedPageParents(PAGE_ACCESS_CATALOG.find(entry => entry.path === '/pm-dashboard/changes'), withoutMain), []);
});

test('Financial WIP and Commitment Maker grants cannot authorize sibling data APIs', () => {
  for (const [page, allowedApi, deniedApis] of [
    ['/analytics/monthly-hours', '/api/analytics/monthly-hours', ['/api/analytics/commitment-productivity', '/api/analytics/cost-code-sales', '/api/accounting/billing-analytics']],
    ['/procore/commitments-live/maker', '/api/procore/commitments-live/maker', ['/api/procore/commitments-live', '/api/procore/commitments-live/allocation', '/api/procore/vendors']],
  ]) {
    const permissions = expandAssignedPermissions([pagePermission(page)]);
    const can = api => apiPagePermissions(api).some(permission => permissions.includes(permission));
    assert.equal(can(allowedApi), true);
    for (const api of deniedApis) assert.equal(can(api), false, api);
  }
});

test('signed permission cache fits browser limits and preserves independent role revocations', async () => {
  const previous = process.env.PERMISSIONS_COOKIE_SECRET;
  process.env.PERMISSIONS_COOKIE_SECRET = 'page-catalog-test-secret';
  try {
    const grants = expandAssignedPermissions(['OWNER', 'billing-analytics', '!page:/analytics/monthly-hours']);
    const cookie = await createPermissionCookieValue('owner@example.test', grants);
    assert.ok(cookie && cookie.length <= 3800);
    const payload = await verifyPermissionCookieValue(cookie, 'owner@example.test');
    assert.ok(payload.permissions.includes('page:/market-outlook'));
    assert.ok(payload.permissions.includes('admin'));
    assert.ok(payload.permissions.includes('page:/help/billing-analytics'));
    assert.ok(!payload.permissions.includes('page:/analytics/monthly-hours'));
    assert.equal(await verifyPermissionCookieValue(cookie, 'someone-else@example.test'), null);
    assert.equal(await createPermissionCookieValue('owner@example.test', Array.from({ length: 500 }, (_, i) => `page:/long-page-name-${i}`)), null);
  } finally {
    if (previous === undefined) delete process.env.PERMISSIONS_COOKIE_SECRET;
    else process.env.PERMISSIONS_COOKIE_SECRET = previous;
  }
});

test('page inventory follows route groups, slots, interception and dynamic paths without private files', () => {
  for (const [source, expected] of [
    ['page.tsx', '/'], ['(reports)/new-report/page.tsx', '/new-report'], ['(.reports)/new-report/page.tsx', '/new-report'],
    ['work/@modal/(..)photo/[id]/page.tsx', '/photo/[id]'],
    ['work/@modal/(.)photo/page.tsx', '/work/photo'],
    ['work/deep/(..)(..)photo/page.jsx', '/photo'],
    ['work/deep/(...)photo/page.js', '/photo'],
    ['@summary/page.tsx', '/'], ['_private/example/page.tsx', null],
    ['%5Fvisible/page.tsx', '/_visible'], ['example/route.ts', null], ['example/page.module.css', null],
  ]) assert.equal(pageRouteFromFile(source), expected, source);
  const pages = [{ pathname: '/new/[id]' }, { pathname: '/files/[...parts]' }, { pathname: '/docs/[[...parts]]' }];
  assert.equal(resolveDiscoveredPagePermission('/new/123', pages), 'page:/new/[id]');
  assert.equal(resolveDiscoveredPagePermission('/new', pages), null);
  assert.equal(resolveDiscoveredPagePermission('/new/123/extra', pages), null);
  assert.equal(resolveDiscoveredPagePermission('/files', pages), null);
  assert.equal(resolveDiscoveredPagePermission('/files/a/b', pages), 'page:/files/[...parts]');
  assert.equal(resolveDiscoveredPagePermission('/docs', pages), 'page:/docs/[[...parts]]');
  assert.equal(resolveDiscoveredPagePermission('/api/new', [{ pathname: '/api/new' }]), null);
  assert.equal(resolveDiscoveredPagePermission('/help/unknown-guide', APP_PAGES), null);
  assert.equal(resolveDiscoveredPagePermission('/new/123', [{ pathname: '/[...all]' }, { pathname: '/new/[id]' }]), 'page:/new/[id]');
});

test('creating a new page automatically adds a protected assignable entry and live discovery notices removal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'analytics-page-catalog-'));
  const app = join(root, 'src/app');
  mkdirSync(app, { recursive: true });
  generateAppPageInventory(root);
  const watcher = watchAppPageInventory(root);
  const generated = join(root, 'src/lib/generated/appPages.js');
  async function waitFor(check) {
    const deadline = Date.now() + 5000;
    while (!check()) {
      assert.ok(Date.now() < deadline, 'page catalog watcher did not refresh');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }
  try {
    const directory = join(app, '(new)', 'future-report');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'page.tsx'), 'export default function Page() { return null; }');
    await waitFor(() => readFileSync(generated, 'utf8').includes('/future-report'));
    const pages = discoverAppPages(app);
    const entry = buildPageAccessCatalog(pages).find(entry => entry.path === '/future-report');
    assert.equal(entry.label, 'Future Report');
    assert.equal(entry.permission, 'page:/future-report');
    assert.equal(resolveDiscoveredPagePermission('/future-report', pages), entry.permission);
    for (const role of ['OWNER', 'ADMIN', 'ESTIMATOR', 'analytics']) assert.equal(expandAssignedPermissions([role]).includes(entry.permission), false);
    assert.ok(expandAssignedPermissions([entry.permission]).includes(entry.permission));
    rmSync(join(directory, 'page.tsx'));
    await waitFor(() => !readFileSync(generated, 'utf8').includes('/future-report'));
  } finally {
    watcher.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('analytics-page-catalog-'));
    rmSync(root, { recursive: true, force: true });
  }
});
