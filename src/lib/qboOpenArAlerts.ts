import { randomUUID } from 'node:crypto';
import type { Store } from '@netlify/blobs';

const descriptions = {
  failed: 'The QuickBooks host reported that an Open A/R refresh failed.',
  expired: 'An Open A/R refresh exceeded its five-minute deadline.',
  offline: 'Analytics could not reach the QuickBooks host.',
  stale: 'The last saved Open A/R report is more than 75 minutes old.',
  missing: 'Analytics could not find a saved Open A/R report.',
  unavailable: 'The monitor could not check Open A/R refresh status in Analytics.',
  recentFailure: 'An Open A/R refresh failed or expired between monitoring checks.',
};

type ReportReason = Exclude<keyof typeof descriptions, 'unavailable' | 'recentFailure'>;
type Status = { reason: ReportReason | null; lastReadAt: string | null; lastFailureId: string | null };
type Alert = { id: string; reason: keyof typeof descriptions; detectedAt: string; lastReadAt: string | null };
type State = {
  hasStatus: boolean;
  lastReadAt: string | null;
  lastFailureId: string | null;
  incident: (Alert & { sent: boolean }) | null;
};

export function parseOpenArAlertStatus(value: unknown): Status {
  if (!value || typeof value !== 'object') throw new Error('Missing Open A/R status.');
  const { reason, lastReadAt, lastFailureId } = value as Status;
  if (!(reason === null || ['failed', 'expired', 'offline', 'stale', 'missing'].includes(reason))
    || !(lastReadAt === null || (typeof lastReadAt === 'string' && Number.isFinite(Date.parse(lastReadAt))))
    || !(lastFailureId === null || (typeof lastFailureId === 'string' && lastFailureId.length > 0))) {
    throw new Error('Invalid Open A/R status.');
  }
  return { reason, lastReadAt, lastFailureId };
}

const eastern = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
export function openArAlertEmail(alert: Alert) {
  const time = (date: string) => eastern.format(new Date(date)) + ' Eastern';
  return {
    to: ['todd@pmcdecor.com'],
    subject: '[Analytics] QuickBooks Open A/R refresh needs attention',
    text: [
      descriptions[alert.reason],
      'Detected ' + time(alert.detectedAt) + '.',
      alert.lastReadAt ? 'Last known successful QBO read was ' + time(alert.lastReadAt) + '.' : 'The monitor has no confirmed successful refresh time.',
      '',
      'Open the report and check the Refreshed time. If the report is still out of date, confirm the QuickBooks host is on and signed in, then select Refresh from QBO.',
      'https://analyticspmc.netlify.app/accounting/open-ar',
    ].join('\n'),
  };
}

export async function checkOpenArAlerts(
  store: Pick<Store, 'getWithMetadata' | 'setJSON'>,
  key: string,
  readStatus: () => Promise<Status>,
  send: (alert: Alert) => Promise<void>,
) {
  const saved = await store.getWithMetadata(key, { type: 'json' });
  let state: State = saved?.data ?? { hasStatus: false, lastReadAt: null, lastFailureId: null, incident: null };
  let etag = saved?.etag;
  // Finish a pending delivery with its original message and provider key even after recovery.
  if (!state.incident || state.incident.sent) {
    const status = await readStatus().catch(() => null);
    const newFailure = status?.lastFailureId && state.hasStatus && status.lastFailureId !== state.lastFailureId;
    const reason = !status ? 'unavailable' : status.reason ?? (newFailure ? 'recentFailure' : null);
    const lastReadAt = status ? status.lastReadAt : state.lastReadAt;
    const newReport = lastReadAt && state.incident?.lastReadAt && lastReadAt > state.incident.lastReadAt;
    let incident = state.incident;
    if (!reason) incident = null;
    else if (!incident || (newFailure && newReport)) {
      incident = { id: randomUUID(), reason, detectedAt: new Date().toISOString(), lastReadAt, sent: false };
    }
    const next = { hasStatus: state.hasStatus || !!status, lastReadAt, lastFailureId: status ? status.lastFailureId : state.lastFailureId, incident };
    if (saved && JSON.stringify(next) === JSON.stringify(state)) return incident ? 'already-alerted' : 'healthy';
    const write = await store.setJSON(key, next, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (!write.modified) return 'another-check-updated-state';
    state = next;
    etag = write.etag;
  }
  if (!state.incident) return 'healthy';
  if (state.incident.sent) return 'already-alerted';
  await send(state.incident);
  await store.setJSON(key, { ...state, incident: { ...state.incident, sent: true } }, { onlyIfMatch: etag });
  return 'alerted';
}
