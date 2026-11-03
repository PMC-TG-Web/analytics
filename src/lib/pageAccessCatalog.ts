import { APP_PAGES } from './generated/appPages.js';
import { PAGE_REDIRECTS, SYSTEM_PAGE_NOTES, resolveDiscoveredPagePermission } from './appPagePolicy.js';
import { resolvePermissionForPath } from './permissionRoutes.js';
import { pagePermission, supportingPageParents } from './independentPagePermissions.js';
import { HELP_GUIDE_SUMMARIES } from './helpGuides/catalog.ts';

export const PERMISSION_LABELS: Record<string, string> = {
  home: 'Home', dashboard: 'Dashboard', 'pm-dashboard': 'My Work', projects: 'Projects',
  project: 'Project details', procore: 'Procore', kpi: 'KPI', wip: 'WIP',
  'crew-management': 'Crew Management', 'estimating-tools': 'Estimating', constants: 'Constants',
  employees: 'Employees', certifications: 'Certifications', equipment: 'Equipment', holidays: 'Holidays',
  analytics: 'Analytics', 'billing-analytics': 'Billing Analytics',
  'analytics-cost-code-sales': 'Cost Code P&L', 'accounting-project-profitability': 'QBO P&L',
  'accounting-direct-cost-bills': 'QBO Direct Costs', reporting: 'Reporting', onboarding: 'Onboarding',
  handbook: 'Handbook', 'kpi-cards-management': 'Manage KPI Cards',
  scheduling: 'Schedules: WIP Schedule', 'project-schedule': 'Schedules: Project Gantt',
  'long-term-schedule': 'Schedules: Long-Term', 'concrete-orders-schedule': 'Schedules: Concrete Orders',
  'short-term-schedule': 'Schedules: Short-Term', 'crew-dispatch': 'Schedules: Crew Dispatch',
  'procore-timecards': 'Procore: Timecards', 'procore-line-items': 'Procore: Line Items',
  'procore-commitments': 'Procore: Commitments', 'procore-scope-map': 'Procore: Scope Map',
  admin: 'Administration', diagnostics: 'Diagnostics', endpoints: 'Endpoints',
};

const PAGE_NOTES: Record<string, string> = {
  '/procore/commitments-live/allocation': 'Todd-only pilot; this permission does not remove that restriction.',
  '/crew-scorecard': 'Local preview; hidden from production navigation.',
  '/procore/pmc-group-mappings': 'Mapping changes also require Administration access.',
  '/procore/review/bid-board': 'Live Bid Board requests also require Administration access.',
};

export type PageAccessEntry = {
  id: string;
  label: string;
  path: string | null;
  permission: string | null;
  section: 'Pages' | 'Help guides' | 'System and redirected pages' | 'Other access';
  note: string;
  parentPaths: string[];
};

export function readablePageName(pathname: string): string {
  return pathname.split('/').filter(Boolean).map(segment => segment.replaceAll('-', ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())).join(': ') || 'Home';
}

function pageEntry(path: string, helpLabel?: string, pages = APP_PAGES): PageAccessEntry {
  const guide = HELP_GUIDE_SUMMARIES.find(guide => guide.pagePath === path);
  const permission = resolvePermissionForPath(path) || resolveDiscoveredPagePermission(path, pages);
  const systemNote = SYSTEM_PAGE_NOTES[path];
  const destination = PAGE_REDIRECTS[path];
  const label = helpLabel ? `Help: ${helpLabel}`
    : path === '/accounting/billing-analytics' ? 'Billing Analytics'
    : path === '/kpi-cards-management' ? 'Manage KPI Cards'
    : guide?.pageLabel || readablePageName(path);
  return {
    id: path, label, path,
    parentPaths: systemNote || destination ? [] : supportingPageParents(path),
    permission: systemNote || destination ? null : pagePermission(path),
    section: systemNote || destination ? 'System and redirected pages' : helpLabel ? 'Help guides' : 'Pages',
    note: systemNote || (destination ? `Opens ${HELP_GUIDE_SUMMARIES.find(g => g.pagePath === destination)?.pageLabel || destination}; manage access on that page.` : PAGE_NOTES[path] || (permission === 'diagnostics' ? 'Diagnostics may be disabled in production.' : '')),
  };
}

export function buildPageAccessCatalog(pages = APP_PAGES): PageAccessEntry[] {
  const entries = pages.flatMap(page => page.pathname === '/help/[slug]'
    ? HELP_GUIDE_SUMMARIES.map(guide => pageEntry(`/help/${guide.slug}`, guide.pageLabel, pages))
    : [pageEntry(page.pathname, undefined, pages)]);
  return entries.sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

export const PAGE_ACCESS_CATALOG = buildPageAccessCatalog();

export function includedPageParents(entry: PageAccessEntry, effective: readonly string[]) {
  return entry.parentPaths.filter(path => effective.includes(pagePermission(path)))
    .map(path => PAGE_ACCESS_CATALOG.find(parent => parent.path === path)?.label || readablePageName(path));
}

export function filterPageAccessCatalog(query: string, entries = PAGE_ACCESS_CATALOG) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(entry => words.every(word => `${entry.label} ${entry.path || ''} ${entry.permission || ''} ${entry.note}`.toLowerCase().includes(word)));
}
