/** Private billing pilot: broad Analytics/Admin roles cannot expand this list. */
export function canAccessBillingAnalytics(email: string | null | undefined): boolean {
  return typeof email === 'string' && ['todd@pmcdecor.com', 'shelly@pmcdecor.com', 'david@pmcdecor.com'].includes(email.trim().toLowerCase());
}

export function isBillingAnalyticsPath(pathname: string): boolean {
  return ['/accounting/billing-analytics', '/api/accounting/billing-analytics']
    .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
