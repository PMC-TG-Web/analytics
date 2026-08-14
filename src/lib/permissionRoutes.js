export const PATH_PERMISSION_RULES = [
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
  { prefix: '/wip', permission: 'wip' },
  { prefix: '/analytics/cost-code-sales', permission: 'analytics-cost-code-sales' },
  { prefix: '/analytics', permission: 'analytics' },
  { prefix: '/accounting/project-profitability', permission: 'accounting-project-profitability' },
  { prefix: '/', permission: 'home' },
];

const API_PERMISSION_RULES = [
  { prefix: '/api/admin', permission: 'admin' },
  { prefix: '/api/accounting/project-profitability', permission: 'accounting-project-profitability' },
  { prefix: '/api/analytics/cost-code-sales', permission: 'analytics-cost-code-sales' },
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
  { prefix: '/api/dashboard-summary', permission: 'dashboard' },
  { prefix: '/api/estimating-constants', permission: 'estimating-tools' },
  { prefix: '/api/estimates', permission: 'estimating-tools' },
  { prefix: '/api/kpi-cards', permission: 'kpi' },
  { prefix: '/api/kpi', permission: 'kpi' },
  { prefix: '/api/equipment-assignments', permission: 'equipment' },
  { prefix: '/api/equipment', permission: 'equipment' },
  { prefix: '/api/certifications', permission: 'certifications' },
  { prefix: '/api/holidays', permission: 'holidays' },
  { prefix: '/api/employees', permission: 'employees' },
  { prefix: '/api/onboarding-submissions', permission: 'onboarding' },
  { prefix: '/api/permission-templates', permission: 'employees' },
  { prefix: '/api/projects', permission: 'projects' },
  { prefix: '/api/procore', permission: 'procore' },
];

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
