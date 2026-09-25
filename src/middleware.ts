// Next.js discovers middleware alongside src/app. Keep the existing policy in one place.
export { middleware } from '../middleware';

export const config = {
  matcher: [
    '/((?!api/background/(?:actuals-sync|nightly-structure-sync|change-order-approvals|commitment-maker-tasks|pm-dashboard-sync|calendar-sync|project-reconciliation|analytics-connection-check)/?$|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
