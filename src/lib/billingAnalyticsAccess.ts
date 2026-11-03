// Keep local development bypasses from skipping this report's permission check.
export function isBillingAnalyticsPath(pathname: string): boolean {
  return ['/accounting/billing-analytics', '/api/accounting/billing-analytics']
    .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
