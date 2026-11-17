import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const enabled = process.env.NAVIGATION_PERMISSIONS_BROWSER_TEST === '1';
const email = 'operator@example.test';

test('navigation hides restricted links during slow sign-in, failures and revocation, then recovers', { skip: !enabled, timeout: 120_000 }, async () => {
  // Exercise the real component and auth/permission helpers in an isolated browser fixture.
  const require = createRequire(import.meta.url);
  const esbuild = require(process.env.WIP_TEST_ESBUILD || path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import Navigation from ${JSON.stringify(path.resolve('src/components/Navigation.tsx'))}; createRoot(document.getElementById('root')).render(<Navigation forceRender/>);`;
  const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' },
    write: false, bundle: true, platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'navigation-framework-fixture', setup(build) {
      build.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'framework-fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'framework-fixture' }, args => ({
        contents: args.path === 'next/navigation'
          ? 'export function usePathname() { return "/"; }'
          : 'export default function Link({href, children, ...props}) { return <a href={href} {...props}>{children}</a>; }',
        loader: 'tsx', resolveDir: process.cwd(),
      }));
    } }],
  });
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? built.outputFiles[0].text : '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.clock.install();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let status = 200;
  let permissions = ['page:/analytics'];
  let responseEmail = email;
  // Every browser API request is a fixture; no account or business data is changed.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { email, name: 'Navigation fixture' } });
    if (path === '/api/permissions/me') {
      await gate;
      return route.fulfill({ status, json: { success: status === 200, data: { email: responseEmail, permissions } } });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.addInitScript(() => {
    window.unexpectedNavigationLinks = [];
    new MutationObserver(() => {
      for (const link of document.querySelectorAll('nav[aria-label="Main navigation"] a')) {
        const href = link.getAttribute('href');
        if (!['/help', '/analytics'].includes(href)) window.unexpectedNavigationLinks.push(href);
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const menu = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  const hrefs = () => menu.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')).sort());
  const refresh = async () => {
    await page.clock.fastForward(16_000);
    const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/permissions/me');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await response;
    await page.evaluate(() => new Promise(requestAnimationFrame));
  };
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await menu.getByRole('status').filter({ hasText: 'Loading navigation' }).waitFor();
    assert.deepEqual(await hrefs(), ['/help']);
    assert.equal(await menu.getByRole('button', { name: /sign out/i }).isVisible(), true);
    await page.clock.fastForward(5_000);
    assert.deepEqual(await hrefs(), ['/help'], 'slow permissions must never show the full menu');
    release();
    await menu.getByRole('link', { name: 'Analytics', exact: true }).waitFor();
    assert.deepEqual(await hrefs(), ['/analytics', '/help']);

    status = 503;
    await refresh();
    assert.deepEqual(await hrefs(), ['/analytics', '/help'], 'failed background reads retain only confirmed links');
    status = 200;
    permissions = [];
    await refresh();
    await menu.getByRole('link', { name: 'Analytics', exact: true }).waitFor({ state: 'hidden' });
    assert.deepEqual(await hrefs(), ['/help'], 'successful revocation replaces prior grants');
    assert.deepEqual(await page.evaluate(() => window.unexpectedNavigationLinks), []);

    // A first-read failure after reload must stay closed, then recover on focus.
    status = 503;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menu.getByRole('status').filter({ hasText: 'Navigation unavailable' }).waitFor();
    assert.deepEqual(await hrefs(), ['/help']);
    status = 200;
    permissions = ['page:/analytics'];
    await refresh();
    await menu.getByRole('link', { name: 'Analytics', exact: true }).waitFor();
    assert.deepEqual(await hrefs(), ['/analytics', '/help']);
    assert.deepEqual(await page.evaluate(() => window.unexpectedNavigationLinks), []);

    // A different account's successful response is not usable permission evidence.
    responseEmail = 'other@example.test';
    permissions = ['OWNER'];
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menu.getByRole('status').filter({ hasText: 'Navigation unavailable' }).waitFor();
    assert.deepEqual(await hrefs(), ['/help']);
    assert.deepEqual(await page.evaluate(() => window.unexpectedNavigationLinks), []);
    assert.deepEqual(errors, []);
  } catch (error) {
    if (errors.length) throw new AggregateError([error, ...errors], 'Navigation browser errors');
    throw error;
  } finally {
    release();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
