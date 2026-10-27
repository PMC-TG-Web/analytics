// Expiration is a calendar date, valid through that day in the business timezone.
export function certificationDaysRemaining(expiration: string, now = new Date()): number | null {
  const value = expiration.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const expires = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(expires) || new Date(expires).toISOString().slice(0, 10) !== value) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const today = Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  return Math.round((expires - today) / 86_400_000);
}

export function summarizeCertificationExpirations(records: { expirationDate: string }[], now = new Date()) {
  const days = records.map(record => certificationDaysRemaining(record.expirationDate, now));
  return {
    total: days.length,
    expired: days.filter(day => day !== null && day < 0).length,
    expiring30: days.filter(day => day !== null && day >= 0 && day <= 30).length,
    expiring90: days.filter(day => day !== null && day >= 0 && day <= 90).length,
    missingDate: days.filter(day => day === null).length,
  };
}
