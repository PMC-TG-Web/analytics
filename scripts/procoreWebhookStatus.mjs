/**
 * procoreWebhookStatus.mjs
 *
 * Read-only operational status for the Procore webhook + sync pipeline.
 *
 * Usage:
 *   node scripts/procoreWebhookStatus.mjs                 # database view: events, queue, quota, PM dashboard, sync logs
 *   node scripts/procoreWebhookStatus.mjs --deliveries [N] # also ask Procore for delivery status on N project hooks (default 5)
 *   node scripts/procoreWebhookStatus.mjs --hours 6        # widen the lookback window (default 24h)
 *
 * Reads .env then .env.local (local overrides), like Next.js.
 * Requires DATABASE_URL; --deliveries additionally needs PROCORE_CLIENT_ID/SECRET/COMPANY_ID.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const realEnvKeys = new Set(Object.keys(process.env));
function loadEnvFile(filePath, { override = false } = {}) {
  try {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (override ? !realEnvKeys.has(key) : !process.env[key]) process.env[key] = val;
    }
  } catch {
    // optional file
  }
}
const root = resolve(fileURLToPath(import.meta.url), '..', '..');
loadEnvFile(resolve(root, '.env'));
loadEnvFile(resolve(root, '.env.local'), { override: true });

const args = process.argv.slice(2);
function flag(name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  return value === undefined || value.startsWith('--') ? fallback : value;
}
const hours = Math.max(1, Number(flag('--hours', '24')) || 24);
const wantDeliveries = args.includes('--deliveries');
const deliverySample = Math.max(1, Number(flag('--deliveries', '5')) || 5);

const COMPANY_ID = (process.env.PROCORE_COMPANY_ID || '').trim();
const API_URL = (process.env.PROCORE_API_URL || 'https://api.procore.com').replace(/\/$/, '');
const TOKEN_URL = process.env.PROCORE_TOKEN_URL || `${API_URL}/oauth/token`;
const WEBHOOK_NAMESPACE = process.env.PROCORE_WEBHOOK_NAMESPACE || 'pmc-analytics';
const SHARED_SECRET = (process.env.PROCORE_WEBHOOK_SHARED_SECRET || '').trim();

const fmt = (value) => (value instanceof Date ? value.toISOString() : value ?? '-');
const ago = (value) => {
  if (!value) return '-';
  const ms = Date.now() - new Date(value).getTime();
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m ago` : `${(m / 60).toFixed(1)}h ago`;
};
function table(rows, columns) {
  if (!rows.length) return console.log('  (none)');
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(fmt(r[c])).length)));
  console.log('  ' + columns.map((c, i) => c.padEnd(widths[i])).join('  '));
  for (const row of rows) console.log('  ' + columns.map((c, i) => String(fmt(row[c])).padEnd(widths[i])).join('  '));
}

async function dbStatus() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const [control, events, queue, failures, pm, syncLogs, projectHooksKnown] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT rate_limit_until, last_429_at, rate_limit_limit, rate_limit_remaining, rate_limit_reset_at,
                rate_limit_observed_at, worker_locked_by IS NOT NULL AS worker_locked, worker_locked_until
         FROM procore_sync_controls WHERE company_id = $1`,
        COMPANY_ID,
      ),
      prisma.$queryRawUnsafe(
        `SELECT e.resource_name, e.event_type, count(*)::int AS events,
                count(*) FILTER (WHERE q.status = 'completed')::int AS completed,
                count(*) FILTER (WHERE q.status = 'pending')::int AS pending,
                count(*) FILTER (WHERE q.status = 'failed')::int AS failed,
                max(e.received_at) AS latest
         FROM procore_webhook_events e LEFT JOIN procore_webhook_queue q ON q.event_id = e.id
         WHERE e.received_at > NOW() - ($1 * INTERVAL '1 hour')
         GROUP BY 1,2 ORDER BY latest DESC`,
        hours,
      ),
      prisma.$queryRawUnsafe(
        `SELECT status, count(*)::int AS n, min(available_at) AS oldest_available
         FROM procore_webhook_queue WHERE status <> 'completed' GROUP BY 1 ORDER BY 1`,
      ),
      prisma.$queryRawUnsafe(
        `SELECT e.resource_name, e.event_type, q.status, q.attempts, left(q.last_error, 110) AS last_error, q.updated_at
         FROM procore_webhook_queue q JOIN procore_webhook_events e ON e.id = q.event_id
         WHERE q.last_error IS NOT NULL AND q.updated_at > NOW() - ($1 * INTERVAL '1 hour')
         ORDER BY q.updated_at DESC LIMIT 10`,
        hours,
      ),
      prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS projects,
                count(*) FILTER (WHERE last_success_at > NOW() - INTERVAL '3 hours')::int AS succeeded_3h,
                count(*) FILTER (WHERE last_error IS NOT NULL)::int AS with_error,
                count(*) FILTER (WHERE last_error ILIKE '%cooldown%' OR last_error ILIKE '%rate limit%')::int AS cooldown_errors,
                max(last_success_at) AS last_success
         FROM pmc_action_item_sync_state`,
      ),
      prisma.$queryRawUnsafe(
        `SELECT triggered_by, count(*)::int AS runs,
                count(*) FILTER (WHERE success)::int AS ok,
                max(started_at) AS latest
         FROM sync_logs WHERE started_at > NOW() - ($1 * INTERVAL '1 hour')
         GROUP BY 1 ORDER BY latest DESC`,
        hours,
      ),
      prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS active_projects FROM pmc_projects
         WHERE company_id = $1
           AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
           AND lower(COALESCE(status, '')) NOT LIKE '%closed%'
           AND lower(COALESCE(status, '')) NOT LIKE '%cancel%'`,
        COMPANY_ID,
      ),
    ]);

    const c = control[0];
    console.log(`\n== Procore quota / worker (company ${COMPANY_ID}) ==`);
    if (!c) console.log('  (no procore_sync_controls row)');
    else {
      const cooling = c.rate_limit_until && new Date(c.rate_limit_until) > new Date();
      console.log(`  cooldown active:   ${cooling ? `YES until ${fmt(c.rate_limit_until)}` : 'no'}`);
      console.log(`  last 429:          ${fmt(c.last_429_at)} (${ago(c.last_429_at)})`);
      console.log(`  last quota sample: limit=${c.rate_limit_limit} remaining=${c.rate_limit_remaining} reset=${fmt(c.rate_limit_reset_at)} observed ${ago(c.rate_limit_observed_at)}`);
      console.log(`  worker lease:      ${c.worker_locked ? `held until ${fmt(c.worker_locked_until)}` : 'free'}`);
    }

    console.log(`\n== Webhook events received (last ${hours}h) ==`);
    table(events, ['resource_name', 'event_type', 'events', 'completed', 'pending', 'failed', 'latest']);

    console.log('\n== Webhook queue backlog (non-completed) ==');
    table(queue, ['status', 'n', 'oldest_available']);

    console.log(`\n== Recent webhook processing errors (last ${hours}h) ==`);
    table(failures, ['resource_name', 'event_type', 'status', 'attempts', 'last_error', 'updated_at']);

    const p = pm[0];
    console.log('\n== PM dashboard sweep (pmc_action_item_sync_state) ==');
    console.log(`  projects=${p.projects} succeeded_last_3h=${p.succeeded_3h} with_error=${p.with_error} cooldown_errors=${p.cooldown_errors} last_success=${fmt(p.last_success)} (${ago(p.last_success)})`);
    console.log(`  active pmc_projects: ${projectHooksKnown[0]?.active_projects ?? '?'}`);

    console.log(`\n== Sync runs (last ${hours}h) ==`);
    table(syncLogs, ['triggered_by', 'runs', 'ok', 'latest']);
  } finally {
    await prisma.$disconnect();
  }
}

async function procoreToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.PROCORE_CLIENT_ID,
      client_secret: process.env.PROCORE_CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) throw new Error(`token request failed ${res.status}`);
  return (await res.json()).access_token;
}

async function deliveryStatus() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  let projects;
  try {
    projects = await prisma.$queryRawUnsafe(
      `SELECT procore_project_id AS id, project_name AS name FROM pmc_projects
       WHERE company_id = $1
         AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
         AND lower(COALESCE(status, '')) NOT LIKE '%closed%'
         AND lower(COALESCE(status, '')) NOT LIKE '%cancel%'
       ORDER BY procore_updated_at DESC NULLS LAST LIMIT ${Number(deliverySample)}`,
      COMPANY_ID,
    );
  } finally {
    await prisma.$disconnect();
  }

  const token = await procoreToken();
  const headers = { Authorization: `Bearer ${token}`, 'Procore-Company-Id': COMPANY_ID, Accept: 'application/json' };
  console.log(`\n== Procore delivery status (${projects.length} most recently updated projects) ==`);
  for (const project of projects) {
    const base = `${API_URL}/rest/v2.0/companies/${COMPANY_ID}/projects/${project.id}/webhooks`;
    const hooksRes = await fetch(`${base}/hooks?namespace=${encodeURIComponent(WEBHOOK_NAMESPACE)}`, { headers });
    if (hooksRes.status === 429) { console.log('  Procore rate limited; stopping delivery checks.'); return; }
    const hooks = (await hooksRes.json().catch(() => null))?.data || [];
    const hook = hooks[0];
    if (!hook) { console.log(`  ${project.id} ${project.name}: NO HOOK`); continue; }
    const masked = String(hook.destination_headers?.Authorization || '');
    const secretOk = SHARED_SECRET && SHARED_SECRET.endsWith(masked.replace(/^\**/, ''));
    const delRes = await fetch(`${base}/hooks/${hook.id}/deliveries?per_page=10`, { headers });
    const deliveries = (await delRes.json().catch(() => null))?.data || [];
    const summary = deliveries.length
      ? deliveries.map((d) => {
        const last = d.delivery_attempts?.at(-1);
        return `${d.payload?.resource_name}/${d.payload?.event_type}:${d.status}${last ? `(${last.response_status})` : ''}`;
      }).join(', ')
      : 'no deliveries yet';
    console.log(`  ${project.id} ${project.name}: hook ${hook.id} ${hook.status} secret=${secretOk ? 'ok' : 'MISMATCH'}\n      ${summary}`);
  }
}

await dbStatus();
if (wantDeliveries) await deliveryStatus();
