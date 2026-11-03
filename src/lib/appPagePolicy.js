import { APP_PAGES } from './generated/appPages.js';

// Exact existing session/system surfaces only. New pages are protected by default.
export const SYSTEM_PAGE_NOTES = {
  '/': 'Available to every signed-in user.',
  '/help': 'Available to every signed-in user.',
  '/help/home': 'Available to every signed-in user.',
  '/login': 'Sign-in screen; access is managed by authentication.',
  '/forbidden': 'Access-denied screen; no permission can grant it.',
  '/auth/start': 'Part of the sign-in flow.',
  '/auth/complete': 'Part of the sign-in flow.',
  '/auth/logout-complete': 'Part of the sign-out flow.',
};

export const RETIRED_SCHEDULE_PATHS = [
  '/scheduling', '/project-schedule', '/long-term-schedule',
  '/short-term-schedule', '/concrete-orders-schedule', '/daily-crew-dispatch-board',
  '/help/wip-schedule', '/help/project-gantt', '/help/long-term',
  '/help/short-term', '/help/crew-dispatch', '/help/concrete-orders',
];

export const PAGE_REDIRECTS = {
  ...Object.fromEntries(RETIRED_SCHEDULE_PATHS.map(path => [path, path.startsWith('/help/') ? '/help/wip' : '/wip'])),
  '/procore/timecard-time-types': '/procore/timecard-entries',
};

function matchesPage(pattern, pathname) {
  const parts = pattern.split('/').filter(Boolean);
  const actual = pathname.split('/').filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (/^\[\[\.\.\..+\]\]$/.test(part)) return index === parts.length - 1;
    if (/^\[\.\.\..+\]$/.test(part)) return index === parts.length - 1 && actual.length > index;
    if (actual[index] === undefined || part !== actual[index] && !/^\[[^\]]+\]$/.test(part)) return false;
  }
  return parts.length === actual.length;
}

function routeSpecificity(a, b) {
  const left = a.pathname.split('/');
  const right = b.pathname.split('/');
  const score = segment => segment === undefined ? -1 : segment.startsWith('[[...') ? 0 : segment.startsWith('[...') ? 1 : segment.startsWith('[') ? 2 : 3;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = score(right[index]) - score(left[index]);
    if (difference) return difference;
  }
  return a.pathname.localeCompare(b.pathname, 'en');
}

export function resolveDiscoveredPagePermission(pathname, pages = APP_PAGES) {
  if (pathname.startsWith('/api/') || Object.hasOwn(SYSTEM_PAGE_NOTES, pathname)) return null;
  // Prefer concrete pages over dynamic patterns, as the router does.
  const page = pages.find(page => page.pathname === pathname)
    || [...pages].sort(routeSpecificity)
      .find(page => matchesPage(page.pathname, pathname));
  // Help's dynamic file expands from the guide catalog, not arbitrary slugs.
  return page && page.pathname !== '/help/[slug]' ? `page:${page.pathname}` : null;
}
