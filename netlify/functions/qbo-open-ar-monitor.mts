import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { Resend } from 'resend';
import { checkOpenArAlerts, openArAlertEmail, parseOpenArAlertStatus } from '../../src/lib/qboOpenArAlerts.ts';

async function readStatus() {
  const base = process.env.APP_BASE_URL || process.env.URL;
  const secret = (process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || '').trim();
  const url = new URL('/api/cron/qbo-open-ar', base);
  if (!secret || url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid monitor configuration.');
  const response = await fetch(url, {
    headers: { 'x-sync-secret': secret }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Open A/R status unavailable.');
  return parseOpenArAlertStatus(await response.json());
}

export default async function handler() {
  const store = getStore({ name: 'qbo-open-ar-alerts', consistency: 'strong' });
  const company = process.env.PROCORE_COMPANY_ID || 'unconfigured';
  const host = process.env.QBO_BILL_RELAY_HOST_ID || 'primary';
  const outcome = await checkOpenArAlerts(store, company + '/' + host, readStatus, async alert => {
    const from = process.env.SYNC_HEALTH_ALERT_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || 'Analytics Automation <notifications@pmcdecor.com>';
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
      { from, ...openArAlertEmail(alert) }, { idempotencyKey: 'open-ar-' + alert.id },
    );
    if (result.error || !result.data?.id) throw new Error('Open A/R alert delivery was not confirmed.');
  });
  console.log(JSON.stringify({ event: 'qbo-open-ar-monitor', outcome }));
  return Response.json({ outcome });
}

export const config: Config = { schedule: '*/5 * * * *' };
