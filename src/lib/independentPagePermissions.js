import { APP_PAGES } from './generated/appPages.js';
import { HELP_GUIDE_SUMMARIES } from './helpGuides/catalog.ts';
import { SYSTEM_PAGE_NOTES } from './appPagePolicy.js';
import { resolvePermissionForPath } from './permissionRoutes.js';

export const LEGACY_PERMISSION_FALLBACKS = {
  'accounting-project-profitability': 'admin', 'accounting-direct-cost-bills': 'admin',
  'analytics-cost-code-sales': 'analytics', 'procore-timecards': 'procore',
  'procore-line-items': 'procore', 'procore-commitments': 'procore', 'procore-scope-map': 'procore',
};

export const FEATURE_PAGES = {
  home: '/', dashboard: '/dashboard', 'pm-dashboard': '/pm-dashboard', kpi: '/kpi',
  wip: '/wip', projects: '/projects', procore: '/procore', employees: '/employees',
  certifications: '/certifications', equipment: '/equipment', holidays: '/holidays',
  'crew-management': '/crew-management', 'estimating-tools': '/estimating-tools', constants: '/constants',
  analytics: '/analytics', 'billing-analytics': '/accounting/billing-analytics',
  'analytics-cost-code-sales': '/analytics/cost-code-sales',
  'accounting-project-profitability': '/accounting/project-profitability',
  'accounting-direct-cost-bills': '/accounting/direct-cost-bills',
  reporting: '/reporting', onboarding: '/onboarding/submissions', handbook: '/employees/handbook',
  'kpi-cards-management': '/kpi-cards-management', 'procore-timecards': '/procore/timecard-entries',
  'procore-line-items': '/procore/proposal-line-items-live', 'procore-commitments': '/procore/commitments-live',
  'procore-scope-map': '/procore/scope-mapping-review', endpoints: '/endpoints',
  scheduling: '/scheduling', 'project-schedule': '/project-schedule', 'long-term-schedule': '/long-term-schedule',
  'short-term-schedule': '/short-term-schedule', 'concrete-orders-schedule': '/concrete-orders-schedule',
  'crew-dispatch': '/daily-crew-dispatch-board',
};

export const pagePermission = pathname => `page:${pathname}`;
export const denyPagePermission = pathname => `!${pagePermission(pathname)}`;
export const PAGE_PATHS = APP_PAGES.flatMap(page => page.pathname === '/help/[slug]'
  ? HELP_GUIDE_SUMMARIES.map(guide => `/help/${guide.slug}`) : [page.pathname]);

// Help relationships come from the guide catalog automatically. Other supporting
// views are explicit: folder nesting alone must not grant a separate report/tool.
export const SUPPORTING_PAGE_PARENTS = {
  ...Object.fromEntries(HELP_GUIDE_SUMMARIES.map(guide => [`/help/${guide.slug}`, [guide.pagePath]])),
  '/analytics/productivity': ['/analytics'],
  '/pm-dashboard/changes': ['/pm-dashboard'],
  '/procore/review': ['/procore/test'],
  '/procore/review/projects': ['/procore/test'],
  '/procore/review/bid-board': ['/procore/test'],
  '/procore/review/bid-board-search': ['/procore/test'],
};

export function supportingPageParents(pathname) {
  return SUPPORTING_PAGE_PARENTS[pathname] || [];
}

export function includeSupportingPageAccess(permissions) {
  const result = new Set(permissions);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [child, parents] of Object.entries(SUPPORTING_PAGE_PARENTS)) {
      if (!result.has(pagePermission(child)) && parents.some(parent => result.has(pagePermission(parent)))) {
        result.add(pagePermission(child));
        changed = true;
      }
    }
  }
  return [...result];
}

export function independentPermissionForPath(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (Object.hasOwn(SYSTEM_PAGE_NOTES, normalized)) return null;
  if (PAGE_PATHS.includes(normalized)) return pagePermission(normalized);
  // Newly discovered dynamic pages already resolve to their route-pattern key.
  const legacy = resolvePermissionForPath(normalized);
  return legacy?.startsWith('page:') ? legacy : null;
}

export function expandIndependentPagePermissions(legacyPermissions) {
  const assigned = new Set(legacyPermissions.map(value => value.toLowerCase()));
  const result = new Set(legacyPermissions);
  const override = path => assigned.has(denyPagePermission(path).toLowerCase()) ? false
    : assigned.has(pagePermission(path).toLowerCase()) ? true : null;
  for (const path of PAGE_PATHS.filter(path => !path.startsWith('/help/'))) {
    if (Object.hasOwn(SYSTEM_PAGE_NOTES, path)) continue;
    const legacy = resolvePermissionForPath(path);
    const inherited = legacy && !legacy.startsWith('page:') && (assigned.has(legacy.toLowerCase())
      || assigned.has(LEGACY_PERMISSION_FALLBACKS[legacy]));
    if (override(path) ?? inherited) result.add(pagePermission(path));
    else result.delete(pagePermission(path));
  }
  for (const guide of HELP_GUIDE_SUMMARIES) {
    const path = `/help/${guide.slug}`;
    const inherited = guide.pagePath === '/' || assigned.has(guide.pagePermission.toLowerCase())
      || (guide.fallbackPermission && assigned.has(guide.fallbackPermission.toLowerCase()));
    if (override(path) ?? inherited) result.add(pagePermission(path));
    else result.delete(pagePermission(path));
  }
  // A main-page grant includes its supporting pages even if an older individual
  // denial remains saved. Removing the main grant leaves standalone choices intact.
  return includeSupportingPageAccess([...result]);
}

export function updateIndependentPagePermission(assigned, path, enabled) {
  const next = new Set(assigned.filter(permission => ![pagePermission(path), denyPagePermission(path)]
    .some(key => key.toLowerCase() === permission.toLowerCase())));
  next.add(enabled ? pagePermission(path) : denyPagePermission(path));
  return [...next].sort((a, b) => a.localeCompare(b));
}

// API consumers are reviewed explicitly; discovery never infers or grants API access.
// Shared endpoints accept any authorized consuming page, without unlocking sibling pages.
const API_PAGE_RULES = [
  ['/api/reporting/hours', ['/reporting/hours']],
  ['/api/health', ['/diagnostics']],
  ['/api/debug/cookies', ['/debug-cookies']],
  ['/api/procore/test', ['/procore/test', '/auth0-test']],
  ['/api/procore/diagnostics', ['/procore/test']],
  ['/api/explore', ['/endpoints']],
  ['/api/analytics/monthly-hours', ['/analytics/monthly-hours']],
  ['/api/crew-scorecard', ['/crew-scorecard']],
  ['/api/analytics/commitment-productivity', ['/analytics', '/analytics/productivity']],
  ['/api/pm-dashboard/changes', ['/pm-dashboard/changes']],
  ['/api/procore/commitments-live/maker/projects', ['/procore/commitments-live/maker', '/procore/commitments-live/allocation']],
  ['/api/procore/commitments-live/maker', ['/procore/commitments-live/maker']],
  ['/api/procore/commitments-live/allocation', ['/procore/commitments-live/allocation']],
  ['/api/procore/review/productivity-logs', ['/procore/review']],
  ['/api/procore/projects/all-details', ['/procore/review/projects', '/procore/test']],
  ['/api/procore/estimating/bid-board-project-by-id', ['/procore/review/bid-board-search', '/procore/test']],
  ['/api/procore/vendors', ['/procore/vendors', '/procore/test']],
  ['/api/procore/projects-master', ['/procore/proposal-line-items-live']],
  ['/api/onboarding-submissions', ['/onboarding', '/onboarding/submissions']],
  ['/api/certifications/employees', ['/certifications']],
  ['/api/certifications/expiration-review', ['/certifications']],
  ['/api/certifications', ['/certifications', '/employees']],
  ['/api/kpi-cards/seed', ['/seed-kpi-cards']],
  ['/api/kpi-cards', ['/kpi', '/kpi-cards-management']],
  ['/api/estimating-constants', ['/constants', '/estimating-tools']],
  ['/api/procore/projects', ['/procore', '/procore/review/bid-board-search', '/procore/test']],
];

export function apiPagePermissions(pathname, method = 'GET') {
  for (const [prefix, paths] of API_PAGE_RULES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return paths.map(pagePermission);
  }
  // These views previously needed an additional administration capability. Keep writes protected.
  if (method === 'GET' && pathname === '/api/admin/pmc-group-mappings') return [pagePermission('/procore/pmc-group-mappings'), 'admin'];
  if (method === 'GET' && pathname === '/api/procore/estimating/bid-board-projects') return [pagePermission('/procore/review/bid-board'), pagePermission('/procore/test'), 'admin'];
  if (method === 'GET' && pathname === '/api/projects') return ['/projects', '/equipment'].map(pagePermission);
  const legacy = resolvePermissionForPath(pathname);
  return FEATURE_PAGES[legacy] && !Object.hasOwn(SYSTEM_PAGE_NOTES, FEATURE_PAGES[legacy]) ? [pagePermission(FEATURE_PAGES[legacy])] : null;
}

export function permissionForFeature(feature) {
  const normalized = feature.toLowerCase();
  return FEATURE_PAGES[normalized] && !Object.hasOwn(SYSTEM_PAGE_NOTES, FEATURE_PAGES[normalized]) ? pagePermission(FEATURE_PAGES[normalized]) : normalized;
}
