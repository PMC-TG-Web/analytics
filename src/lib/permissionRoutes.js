export const PATH_PERMISSION_RULES = [
  { prefix: '/help/subcontract-allocation', permission: 'procore-commitments' },
  { prefix: '/procore/commitments-live/allocation', permission: 'procore-commitments' },
  { prefix: '/api/procore/commitments-live/allocation', permission: 'procore-commitments' },
  { prefix: '/help/billing-analytics', permission: 'analytics' },
  { prefix: '/accounting/billing-analytics', permission: 'analytics' },
  { prefix: '/wip', permission: 'wip' },
  { prefix: '/help/wip', permission: 'wip' },
  { prefix: '/auth0-test', permission: 'diagnostics' },
  { prefix: '/procore/test', permission: 'diagnostics' },
  { prefix: '/seed-kpi-cards', permission: 'admin' },
  { prefix: '/test-schedules', permission: 'diagnostics' },
  { prefix: '/debug-cookies', permission: 'diagnostics' },
  { prefix: '/dev-login', permission: 'diagnostics' },
  { prefix: '/diagnostics', permission: 'diagnostics' },
  { prefix: '/employees/handbook', permission: 'handbook' },
  { prefix: '/daily-crew-dispatch-board', permission: 'crew-dispatch' },
  { prefix: '/short-term-schedule', permission: 'short-term-schedule' },
  { prefix: '/long-term-schedule', permission: 'long-term-schedule' },
  { prefix: '/concrete-orders-schedule', permission: 'concrete-orders-schedule' },
  { prefix: '/project-schedule', permission: 'project-schedule' },
  { prefix: '/kpi-cards-management', permission: 'kpi-cards-management' },
  { prefix: '/reporting', permission: 'reporting' },
  { prefix: '/estimating-tools', permission: 'estimating-tools' },
  { prefix: '/crew-management', permission: 'crew-management' },
  { prefix: '/pm-dashboard', permission: 'pm-dashboard' },
  { prefix: '/dashboard', permission: 'dashboard' },
  { prefix: '/projects', permission: 'projects' },
  { prefix: '/project', permission: 'project' },
  { prefix: '/procore/timecard-entries', permission: 'procore-timecards' },
  { prefix: '/procore/proposal-line-items-live', permission: 'procore-line-items' },
  { prefix: '/procore/commitments-live', permission: 'procore-commitments' },
  { prefix: '/procore/scope-mapping-review', permission: 'procore-scope-map' },
  { prefix: '/procore', permission: 'procore' },
  { prefix: '/scheduling', permission: 'scheduling' },
  { prefix: '/equipment', permission: 'equipment' },
  { prefix: '/holidays', permission: 'holidays' },
  { prefix: '/employees', permission: 'employees' },
  { prefix: '/onboarding', permission: 'onboarding' },
  { prefix: '/endpoints', permission: 'endpoints' },
  { prefix: '/constants', permission: 'constants' },
  { prefix: '/certifications', permission: 'certifications' },
  { prefix: '/kpi', permission: 'kpi' },
  { prefix: '/market-outlook', permission: 'analytics' },
  { prefix: '/analytics/cost-code-sales', permission: 'analytics-cost-code-sales' },
  { prefix: '/analytics', permission: 'analytics' },
  { prefix: '/accounting/direct-cost-bills', permission: 'accounting-direct-cost-bills' },
  { prefix: '/accounting/project-profitability', permission: 'accounting-project-profitability' },
  // Help guides use the permission of the page they describe; /help itself is open to any signed-in user.
  { prefix: '/help/home', permission: 'home' },
  { prefix: '/help/my-work', permission: 'pm-dashboard' },
  { prefix: '/help/open-changes', permission: 'pm-dashboard' },
  { prefix: '/help/dashboard', permission: 'dashboard' },
  { prefix: '/help/projects', permission: 'projects' },
  { prefix: '/help/estimating', permission: 'estimating-tools' },
  { prefix: '/help/constants', permission: 'constants' },
  { prefix: '/help/kpi', permission: 'kpi' },
  { prefix: '/help/financial-wip', permission: 'analytics' },
  { prefix: '/help/cost-code-profitability', permission: 'analytics-cost-code-sales' },
  { prefix: '/help/qbo-project-profitability', permission: 'accounting-project-profitability' },
  { prefix: '/help/qbo-direct-costs', permission: 'accounting-direct-cost-bills' },
  { prefix: '/help/analytics', permission: 'analytics' },
  { prefix: '/help/field-productivity', permission: 'analytics' },
  { prefix: '/help/market-outlook', permission: 'analytics' },
  { prefix: '/help/reporting', permission: 'reporting' },
  { prefix: '/help/crew-management', permission: 'crew-management' },
  { prefix: '/help/employees', permission: 'employees' },
  { prefix: '/help/certifications', permission: 'certifications' },
  { prefix: '/help/equipment', permission: 'equipment' },
  { prefix: '/help/holidays', permission: 'holidays' },
  { prefix: '/help/onboarding', permission: 'onboarding' },
  { prefix: '/help/handbook', permission: 'handbook' },
  { prefix: '/help/manage-kpis', permission: 'kpi-cards-management' },
  { prefix: '/help/procore', permission: 'procore' },
  { prefix: '/help/timecards', permission: 'procore-timecards' },
  { prefix: '/help/line-items', permission: 'procore-line-items' },
  { prefix: '/help/commitments', permission: 'procore-commitments' },
  { prefix: '/help/commitment-maker', permission: 'procore-commitments' },
  { prefix: '/help/scope-map', permission: 'procore-scope-map' },
  { prefix: '/', permission: 'home' },
];

const API_PERMISSION_RULES = [
  { prefix: '/api/crew-management/employees', permission: 'crew-management' },
  { prefix: '/api/estimating-tools/projects', permission: 'estimating-tools' },
  { prefix: '/api/reporting', permission: 'reporting' },
  { prefix: '/api/accounting/billing-analytics', permission: 'analytics' },
  { prefix: '/api/wip', permission: 'wip' },
  { prefix: '/api/analytics/commitment-productivity/reviews', permission: 'analytics' },
  { prefix: '/api/admin', permission: 'admin' },
  { prefix: '/api/accounting/direct-cost-bills', permission: 'accounting-direct-cost-bills' },
  { prefix: '/api/accounting/project-profitability', permission: 'accounting-project-profitability' },
  { prefix: '/api/analytics/cost-code-sales', permission: 'analytics-cost-code-sales' },
  { prefix: '/api/analytics', permission: 'analytics' },
  { prefix: '/api/cron/sync/logs', permission: 'admin' },
  { prefix: '/api/debug', permission: 'diagnostics' },
  { prefix: '/api/explore', permission: 'diagnostics' },
  { prefix: '/api/health', permission: 'diagnostics' },
  { prefix: '/api/procore/diagnostics', permission: 'diagnostics' },
  { prefix: '/api/procore/test', permission: 'diagnostics' },
  { prefix: '/api/procore/estimating/bid-board-projects', permission: 'admin' },
  { prefix: '/api/procore/estimating/proposals-bulk', permission: 'admin' },
  { prefix: '/api/procore/estimating/proposal-line-items-bulk', permission: 'admin' },
  { prefix: '/api/procore/estimating/proposals-create', permission: 'admin' },
  { prefix: '/api/procore/estimating/proposal-line-item-groups-create', permission: 'admin' },
  { prefix: '/api/procore/estimating/proposal-line-items-create', permission: 'admin' },
  { prefix: '/api/procore/estimating/import-line-item-groups', permission: 'procore' },
  { prefix: '/api/procore/direct-costs/line-items-sync', permission: 'admin' },
  { prefix: '/api/procore/estimating/import-estimate-workbook', permission: 'admin' },
  { prefix: '/api/procore/sync', permission: 'admin' },
  { prefix: '/api/procore/commitments-live', permission: 'procore-commitments' },
  { prefix: '/api/procore/scope-mapping-review', permission: 'procore-scope-map' },
  { prefix: '/api/procore/estimating/proposal-line-items-live', permission: 'procore-line-items' },
  { prefix: '/api/procore/budget-line-items-live', permission: 'procore-line-items' },
  { prefix: '/api/weather', permission: 'home' },
  { prefix: '/api/home-snapshot', permission: 'home' },
  { prefix: '/api/gantt-v2/debug-sync', permission: 'diagnostics' },
  { prefix: '/api/gantt-v2/setup', permission: 'admin' },
  { prefix: '/api/gantt-v2', permission: 'project-schedule' },
  { prefix: '/api/kpi-cards/seed', permission: 'admin' },
  { prefix: '/api/crew-templates', permission: 'crew-management' },
  { prefix: '/api/job-titles', permission: 'employees' },
  { prefix: '/api/status', permission: 'projects' },
  { prefix: '/api/short-term-schedule', permission: 'short-term-schedule' },
  { prefix: '/api/concrete-orders', permission: 'crew-dispatch' },
  { prefix: '/api/long-term-schedule', permission: 'long-term-schedule' },
  { prefix: '/api/project-schedule', permission: 'project-schedule' },
  { prefix: '/api/project-scopes', permission: 'project-schedule' },
  { prefix: '/api/schedule-allocations', permission: 'scheduling' },
  { prefix: '/api/scheduling', permission: 'scheduling' },
  { prefix: '/api/pm-dashboard', permission: 'pm-dashboard' },
  { prefix: '/api/dashboard-summary', permission: 'dashboard' },
  { prefix: '/api/estimating-dashboard', permission: 'dashboard' },
  { prefix: '/api/estimating-constants', permission: 'estimating-tools' },
  { prefix: '/api/estimates', permission: 'estimating-tools' },
  { prefix: '/api/kpi-cards', permission: 'kpi' },
  { prefix: '/api/kpi', permission: 'kpi' },
  { prefix: '/api/equipment-assignments', permission: 'equipment' },
  { prefix: '/api/equipment', permission: 'equipment' },
  { prefix: '/api/certifications', permission: 'certifications' },
  { prefix: '/api/holidays', permission: 'holidays' },
  { prefix: '/api/employees', permission: 'employees' },
  { prefix: '/api/time-off', permission: 'employees' },
  { prefix: '/api/onboarding-submissions', permission: 'onboarding' },
  { prefix: '/api/permission-templates', permission: 'employees' },
  { prefix: '/api/projects', permission: 'projects' },
  { prefix: '/api/projects-v1-live', permission: 'projects' },
  { prefix: '/api/bid-board-live', permission: 'projects' },
  { prefix: '/api/pmc/projects', permission: 'projects' },
  { prefix: '/api/labor-report', permission: 'reporting' },
  { prefix: '/api/procore', permission: 'procore' },
];

// These exceptions apply only to the named request. New sibling/child routes
// must declare their own policy instead of inheriting a session/auth bypass.
const SESSION_ONLY_API_REQUESTS = [
  { path: '/api/permissions/me', methods: ['GET'] },
  { path: '/api/weather', methods: ['GET'] },
  // The route checks current account permissions and restricts self-service
  // requests to the employee linked to the authenticated email.
  { path: '/api/time-off', methods: ['GET', 'POST'] },
];

const PUBLIC_API_REQUESTS = [
  { path: '/api/public/version', methods: ['GET'] },
];

const AUTH_API_REQUESTS = [
  { path: '/api/auth/dev-login', methods: ['GET'] },
  { path: '/api/auth/me', methods: ['GET'] },
  { path: '/api/auth/session', methods: ['POST'] },
  { path: '/api/auth/procore/login', methods: ['GET'] },
  { path: '/api/auth/procore/callback', methods: ['GET'] },
  // Auth0's configured login/callback handlers accept GET. Other SDK defaults
  // (profile/access-token) live outside /api and are not API exceptions.
  { path: '/api/auth/login', methods: ['GET'] },
  { path: '/api/auth/callback', methods: ['GET'] },
  { path: '/api/auth/logout', methods: ['GET', 'POST'] },
  { path: '/api/auth/logout/local', methods: ['GET', 'POST'] },
];

// Each handler validates its own server secret or authenticated identity before
// reading protected data or writing. Sync logs deliberately are not exempt.
const ROUTE_AUTHORIZED_API_REQUESTS = [
  { path: '/api/cron/actuals', methods: ['POST'] },
  { path: '/api/cron/calendar-sync', methods: ['POST'] },
  { path: '/api/cron/change-order-approvals', methods: ['POST'] },
  { path: '/api/cron/commitment-maker-tasks', methods: ['POST'] },
  { path: '/api/cron/market-outlook', methods: ['POST'] },
  { path: '/api/cron/nightly-structure', methods: ['POST'] },
  { path: '/api/cron/pm-dashboard', methods: ['POST'] },
  { path: '/api/cron/productivity-review-reminders', methods: ['POST'] },
  { path: '/api/cron/project-link-sync', methods: ['POST'] },
  { path: '/api/cron/project-onboarding', methods: ['POST'] },
  { path: '/api/cron/project-reconciliation', methods: ['POST'] },
  { path: '/api/cron/qbo-bill-batch', methods: ['POST'] },
  { path: '/api/cron/sync', methods: ['POST'] },
  { path: '/api/cron/sync/health', methods: ['GET', 'POST'] },
  { path: '/api/cron/timecard-notifications', methods: ['POST'] },
  { path: '/api/internal/backfill-gantt-scopes', methods: ['POST'] },
  { path: '/api/internal/backfill-project-scopes-to-gantt', methods: ['GET', 'POST'] },
  { path: '/api/internal/check-duplicate-projects', methods: ['GET'] },
  { path: '/api/internal/debug-scope-project-split', methods: ['GET'] },
  { path: '/api/internal/dedupe-project-scopes', methods: ['POST'] },
  { path: '/api/internal/export-kpi-entries', methods: ['GET'] },
  { path: '/api/internal/import-kpi-entries', methods: ['POST'] },
  { path: '/api/internal/merge-duplicate-projects', methods: ['POST'] },
  { path: '/api/internal/permission-check', methods: ['POST'] },
  { path: '/api/internal/pmc-projects-compare', methods: ['GET'] },
  { path: '/api/internal/project-lookup', methods: ['GET'] },
  { path: '/api/internal/projects-audit', methods: ['GET'] },
  { path: '/api/internal/projects-diagnostics', methods: ['GET'] },
  { path: '/api/internal/repair-project-identity', methods: ['POST'] },
  { path: '/api/internal/reset-procore-data', methods: ['POST'] },
  { path: '/api/internal/scope-diagnostics', methods: ['GET'] },
  { path: '/api/webhooks/procore', methods: ['POST'] },
  { path: '/api/webhooks/procore/process', methods: ['POST'] },
];

// Netlify owns these paths outside the Next.js route inventory. This declares
// their policy without turning it into an unconditional middleware bypass.
const WORKER_API_REQUESTS = [
  { path: '/api/background/actuals-sync', methods: ['POST'] },
  { path: '/api/background/nightly-structure-sync', methods: ['POST'] },
  { path: '/api/background/change-order-approvals', methods: ['POST'] },
  { path: '/api/background/commitment-maker-tasks', methods: ['POST'] },
  { path: '/api/background/pm-dashboard-sync', methods: ['POST'] },
  { path: '/api/background/calendar-sync', methods: ['POST'] },
  { path: '/api/background/project-reconciliation', methods: ['POST'] },
  { path: '/api/background/analytics-connection-check', methods: ['POST'] },
  { path: '/api/background/qbo-bill-batch', methods: ['POST'] },
];

function matchesApiRequest(requests, pathname, method) {
  const normalizedPath = normalizePath(pathname);
  const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : '';
  return requests.some((request) => request.path === normalizedPath && request.methods.includes(normalizedMethod));
}

export function isSessionOnlyApiRequest(pathname, method) {
  return matchesApiRequest(SESSION_ONLY_API_REQUESTS, pathname, method);
}

export function isPublicApiRequest(pathname, method) {
  return matchesApiRequest(PUBLIC_API_REQUESTS, pathname, method);
}

export function isAuthApiRequest(pathname, method) {
  return matchesApiRequest(AUTH_API_REQUESTS, pathname, method);
}

export function isRouteAuthorizedApiRequest(pathname, method) {
  return matchesApiRequest(ROUTE_AUTHORIZED_API_REQUESTS, pathname, method);
}

export function isWorkerApiRequest(pathname, method) {
  return matchesApiRequest(WORKER_API_REQUESTS, pathname, method);
}

export function hasApiAccessPolicy(pathname, method) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/api/')) return false;
  return resolvePermissionForPath(pathname) !== null
    || isSessionOnlyApiRequest(pathname, method)
    || isPublicApiRequest(pathname, method)
    || isAuthApiRequest(pathname, method)
    || isRouteAuthorizedApiRequest(pathname, method)
    || isWorkerApiRequest(pathname, method);
}

function normalizePath(pathname) {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function resolvePermissionForPath(pathname) {
  const normalizedPath = normalizePath(pathname);
  const rules = normalizedPath.startsWith('/api/') ? API_PERMISSION_RULES : PATH_PERMISSION_RULES;

  for (const rule of rules) {
    if (rule.prefix === '/') {
      if (normalizedPath === '/') {
        return rule.permission;
      }
      continue;
    }

    if (normalizedPath === rule.prefix || normalizedPath.startsWith(`${rule.prefix}/`)) {
      return rule.permission;
    }
  }

  return null;
}
