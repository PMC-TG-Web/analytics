import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  hasApiAccessPolicy,
  isAuthApiRequest,
  isPublicApiRequest,
  isRouteAuthorizedApiRequest,
  isSessionOnlyApiRequest,
  isWorkerApiRequest,
  resolvePermissionForPath,
} from '../src/lib/permissionRoutes.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiRoot = join(root, 'src/app/api');
const httpMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function routeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : /^route\.(ts|js)$/.test(entry.name) ? [path] : [];
  });
}

function exportedHttpMethods(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const statement of source.statements) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isFunctionDeclaration(statement) && statement.name) names.add(statement.name.text);
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const declaration of statement.exportClause.elements) names.add(declaration.name.text);
    }
  }
  return [...names].filter((name) => httpMethods.has(name)).sort();
}

test('every implemented API method has a permission or an explicit request policy', () => {
  const missing = [];
  const files = routeFiles(apiRoot);
  assert.ok(files.length > 100, 'API inventory must inspect the application route tree');
  for (const file of files) {
    const pathname = `/api/${relative(apiRoot, file).replaceAll('\\', '/').replace(/\/route\.(ts|js)$/, '')}`;
    const methods = exportedHttpMethods(file);
    assert.ok(methods.length > 0, `${pathname} has no recognized HTTP export; update the inventory parser`);

    if (pathname === '/api/auth/[auth0]') {
      // The dynamic wrapper delegates to Auth0, which handles only the configured
      // concrete login/callback GET requests. It does not exempt arbitrary names.
      assert.deepEqual(methods, ['GET', 'POST']);
      for (const action of ['login', 'callback']) {
        assert.equal(hasApiAccessPolicy(`/api/auth/${action}`, 'GET'), true);
        assert.equal(hasApiAccessPolicy(`/api/auth/${action}`, 'POST'), false);
      }
      assert.equal(hasApiAccessPolicy('/api/auth/unknown-action', 'GET'), false);
      continue;
    }

    for (const method of methods) {
      if (!hasApiAccessPolicy(pathname, method)) missing.push(`${method} ${pathname}`);
    }
  }
  assert.deepEqual(missing, [], `Declare access policies for:\n${missing.join('\n')}`);
});

test('previously unmapped business APIs use their page permissions', () => {
  for (const [pathname, permission] of [
    ['/api/analytics/advanced', 'analytics'],
    ['/api/analytics/monthly-hours', 'analytics'],
    ['/api/analytics/commitment-productivity', 'analytics'],
    ['/api/analytics/commitment-productivity/logs', 'analytics'],
    ['/api/analytics/commitment-productivity/readiness', 'analytics'],
    ['/api/analytics/commitment-productivity/timecards', 'analytics'],
    ['/api/analytics/cost-code-sales', 'analytics-cost-code-sales'],
    ['/api/projects-v1-live', 'projects'],
    ['/api/bid-board-live', 'projects'],
    ['/api/pmc/projects', 'projects'],
    ['/api/estimating-dashboard', 'dashboard'],
    ['/api/labor-report', 'reporting'],
    ['/api/cron/sync/logs', 'admin'],
    ['/api/time-off', 'employees'],
  ]) {
    assert.equal(resolvePermissionForPath(pathname), permission, pathname);
    assert.equal(hasApiAccessPolicy(pathname, 'GET'), true, pathname);
  }
});

test('session-only exceptions cover exact reads and server-checked self-service writes', () => {
  for (const pathname of ['/api/permissions/me', '/api/weather', '/api/time-off']) {
    assert.equal(isSessionOnlyApiRequest(pathname, 'GET'), true, pathname);
    assert.equal(isSessionOnlyApiRequest(`${pathname}/unreviewed`, 'GET'), false, pathname);
    assert.equal(isSessionOnlyApiRequest(pathname, 'DELETE'), false, pathname);
  }
  assert.equal(isSessionOnlyApiRequest('/api/time-off', 'POST'), true);
  assert.equal(isSessionOnlyApiRequest('/api/permissions/me', 'POST'), false);
  assert.equal(isSessionOnlyApiRequest('/api/weather', 'POST'), false);
});

test('public version access does not grant adjacent paths or write methods', () => {
  assert.equal(isPublicApiRequest('/api/public/version', 'GET'), true);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal(isPublicApiRequest('/api/public/version', method), false, method);
    assert.equal(hasApiAccessPolicy('/api/public/version', method), false, method);
  }
  assert.equal(hasApiAccessPolicy('/api/public/version/extra', 'GET'), false);
  assert.equal(hasApiAccessPolicy('/api/public/new-endpoint', 'GET'), false);
});

test('authentication exceptions use only configured routes and supported methods', () => {
  for (const pathname of ['/api/auth/dev-login', '/api/auth/me', '/api/auth/procore/login', '/api/auth/procore/callback', '/api/auth/login', '/api/auth/callback']) {
    assert.equal(isAuthApiRequest(pathname, 'GET'), true, pathname);
    assert.equal(isAuthApiRequest(pathname, 'POST'), false, pathname);
    assert.equal(isAuthApiRequest(`${pathname}/extra`, 'GET'), false, pathname);
  }
  for (const pathname of ['/api/auth/logout', '/api/auth/logout/local']) {
    assert.equal(isAuthApiRequest(pathname, 'GET'), true, pathname);
    assert.equal(isAuthApiRequest(pathname, 'POST'), true, pathname);
    assert.equal(isAuthApiRequest(pathname, 'DELETE'), false, pathname);
  }
  assert.equal(isAuthApiRequest('/api/auth/session', 'POST'), true);
  assert.equal(isAuthApiRequest('/api/auth/session', 'GET'), false);
  assert.equal(isAuthApiRequest('/api/auth/new-operation', 'GET'), false);
  assert.equal(isAuthApiRequest('/api/auth/procore/new-operation', 'GET'), false);
});

test('route-owned authentication never exempts sync logs or new descendants', () => {
  for (const [pathname, method] of [
    ['/api/cron/sync', 'POST'],
    ['/api/cron/sync/health', 'GET'],
    ['/api/cron/sync/health', 'POST'],
    ['/api/internal/permission-check', 'POST'],
    ['/api/internal/pmc-projects-compare', 'GET'],
    ['/api/internal/backfill-project-scopes-to-gantt', 'GET'],
    ['/api/internal/backfill-project-scopes-to-gantt', 'POST'],
    ['/api/webhooks/procore', 'POST'],
    ['/api/webhooks/procore/process', 'POST'],
  ]) {
    assert.equal(isRouteAuthorizedApiRequest(pathname, method), true, `${method} ${pathname}`);
    assert.equal(isRouteAuthorizedApiRequest(`${pathname}/extra`, method), false, pathname);
    assert.equal(isRouteAuthorizedApiRequest(pathname, 'DELETE'), false, pathname);
  }
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/sync/logs', 'GET'), false);
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/sync', 'GET'), false);
  assert.equal(isRouteAuthorizedApiRequest('/api/webhooks/procore', 'GET'), false);
  assert.equal(hasApiAccessPolicy('/api/cron/sync/new-operation', 'POST'), false);
  assert.equal(hasApiAccessPolicy('/api/internal/new-operation', 'POST'), false);
});

test('Netlify worker policies stay distinct from unconditional route exemptions', () => {
  const files = readdirSync(join(root, 'netlify/functions')).filter((name) => name.endsWith('.mts'));
  const workerPaths = files.flatMap((file) => {
    const source = readFileSync(join(root, 'netlify/functions', file), 'utf8');
    return [...source.matchAll(/path:\s*["'](\/api\/background\/[^"']+)["']/g)].map((match) => match[1]);
  });
  assert.equal(workerPaths.length, 9);
  for (const pathname of workerPaths) {
    assert.equal(isWorkerApiRequest(pathname, 'POST'), true, pathname);
    assert.equal(hasApiAccessPolicy(pathname, 'POST'), true, pathname);
    assert.equal(isRouteAuthorizedApiRequest(pathname, 'POST'), false, pathname);
    assert.equal(hasApiAccessPolicy(pathname, 'GET'), false, pathname);
    assert.equal(hasApiAccessPolicy(`${pathname}/extra`, 'POST'), false, pathname);
  }
  assert.equal(hasApiAccessPolicy('/api/background/new-worker', 'POST'), false);
});

test('unknown API families have no policy for any identity or HTTP method', () => {
  for (const pathname of ['/api/new-feature', '/api/permissions/admin', '/api/auth-proxy', '/api', '/', '/unknown-page']) {
    for (const method of httpMethods) assert.equal(hasApiAccessPolicy(pathname, method), false, `${method} ${pathname}`);
  }
});
