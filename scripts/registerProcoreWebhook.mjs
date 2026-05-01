/**
 * registerProcoreWebhook.mjs
 *
 * Registers (or lists) Procore webhook hooks and triggers for this application.
 *
 * Usage:
 *   node scripts/registerProcoreWebhook.mjs                  # list existing hooks
 *   node scripts/registerProcoreWebhook.mjs --register       # register hook + triggers
 *   node scripts/registerProcoreWebhook.mjs --delete <hookId> # delete a hook
 *
 * Required env vars (loads .env then .env.local):
 *   PROCORE_CLIENT_ID
 *   PROCORE_CLIENT_SECRET
 *   PROCORE_COMPANY_ID
 *   PROCORE_WEBHOOK_SHARED_SECRET
 *   PROCORE_API_URL          (default: https://api.procore.com)
 *   PROCORE_TOKEN_URL        (default: https://api.procore.com/oauth/token)
 *   WEBHOOK_DESTINATION_URL  (override, default: https://analytics-nine-phi.vercel.app/api/webhooks/procore)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// ─── Minimal .env loader ────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // file may not exist — that's fine
  }
}

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(__dirname, '..');
loadEnvFile(resolve(root, '.env'));
loadEnvFile(resolve(root, '.env.local'));

// ─── Config ──────────────────────────────────────────────────────────────────
const CLIENT_ID = process.env.PROCORE_CLIENT_ID;
const CLIENT_SECRET = process.env.PROCORE_CLIENT_SECRET;
const COMPANY_ID = process.env.PROCORE_COMPANY_ID;
const SHARED_SECRET = process.env.PROCORE_WEBHOOK_SHARED_SECRET;
const API_URL = (process.env.PROCORE_API_URL || 'https://api.procore.com').replace(/\/$/, '');
const TOKEN_URL = process.env.PROCORE_TOKEN_URL || `${API_URL}/oauth/token`;
const DESTINATION_URL = process.env.WEBHOOK_DESTINATION_URL || 'https://analytics-nine-phi.vercel.app/api/webhooks/procore';

// Resources and event types to register triggers for.
const TRIGGERS = [
  { resourceName: 'Projects', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Timecard Entries', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Productivity Logs', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Commitment Contracts', eventTypes: ['create', 'update', 'delete'] },
];

// ─── OAuth token ─────────────────────────────────────────────────────────────
async function getToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token request failed ${res.status}: ${text}`);
  }

  const json = await res.json();
  return json.access_token;
}

// ─── API helpers ─────────────────────────────────────────────────────────────
async function apiGet(token, path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Procore-Company-Id': COMPANY_ID,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiPost(token, path, payload) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Procore-Company-Id': COMPANY_ID,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiDelete(token, path) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Procore-Company-Id': COMPANY_ID,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE ${path} failed ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

// ─── Webhook hook & trigger operations ───────────────────────────────────────

async function listHooks(token) {
  const data = await apiGet(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks`);
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function listTriggers(token, hookId) {
  const data = await apiGet(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks/${hookId}/triggers`);
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function createHook(token) {
  return apiPost(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks`, {
    payload_version: 'v2',
    namespace: 'pmc-analytics',
    destination_url: DESTINATION_URL,
    destination_headers: {
      Authorization: `Bearer ${SHARED_SECRET}`,
    },
  });
}

async function createTrigger(token, hookId, resourceName, eventType) {
  return apiPost(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks/${hookId}/triggers`, {
    resource_name: resourceName,
    event_type: eventType,
    api_version: 'v2',
  });
}

async function deleteHook(token, hookId) {
  return apiDelete(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks/${hookId}`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdList() {
  console.log('Fetching access token...');
  const token = await getToken();
  console.log('Listing webhook hooks for company', COMPANY_ID);
  const list = await listHooks(token);
  if (!list.length) {
    console.log('No hooks found.');
    return;
  }
  for (const hook of list) {
    console.log(`\nHook id=${hook.id}`);
    console.log(`  destination: ${hook.destination_url}`);
    console.log(`  status:      ${hook.status}`);
    console.log(`  namespace:   ${hook.namespace}`);
    console.log(`  created:     ${hook.created_at}`);
    try {
      const trigList = await listTriggers(token, hook.id);
      if (trigList.length) {
        console.log('  triggers:');
        for (const t of trigList) {
          console.log(`    - ${t.resource_name} / ${t.event_type}`);
        }
      } else {
        console.log('  triggers: (none)');
      }
    } catch (e) {
      console.log(`  triggers: (error fetching — ${e.message})`);
    }
  }
}

async function cmdRegister() {
  if (!SHARED_SECRET) {
    console.error('ERROR: PROCORE_WEBHOOK_SHARED_SECRET is not set in .env.local');
    process.exit(1);
  }

  console.log('Fetching access token...');
  const token = await getToken();

  console.log(`Creating hook → ${DESTINATION_URL}`);
  let hook;
  try {
    hook = await createHook(token);
  } catch (err) {
    console.error('Failed to create hook:', err.message);
    process.exit(1);
  }

  const hookId = hook?.data?.id ?? hook?.id;
  if (!hookId) {
    console.error('Hook created but could not parse hook id from response:', JSON.stringify(hook));
    process.exit(1);
  }
  console.log(`Hook created: id=${hookId}`);

  let successCount = 0;
  for (const { resourceName, eventTypes } of TRIGGERS) {
    for (const eventType of eventTypes) {
      try {
        const trigResult = await createTrigger(token, hookId, resourceName, eventType);
        const triggerId = trigResult?.data?.id ?? trigResult?.id ?? '?';
        console.log(`  ✓ trigger: ${resourceName} / ${eventType} (id=${triggerId})`);
        successCount++;
      } catch (err) {
        console.warn(`  ✗ trigger failed (${resourceName} / ${eventType}): ${err.message}`);
      }
    }
  }

  console.log(`\nDone. Hook id=${hookId}, ${successCount} triggers registered.`);
  console.log('\nNext steps:');
  console.log('  1. Add PROCORE_WEBHOOK_SHARED_SECRET to Vercel environment variables.');
  console.log('  2. Add PROCORE_SYNC_SECRET to Vercel environment variables.');
  console.log('  3. Deploy (git push) so the webhook receiver goes live.');
}

async function cmdDelete(hookId) {
  if (!hookId) {
    console.error('Usage: node scripts/registerProcoreWebhook.mjs --delete <hookId>');
    process.exit(1);
  }
  console.log('Fetching access token...');
  const token = await getToken();
  console.log(`Deleting hook ${hookId}...`);
  await deleteHook(token, hookId);
  console.log('Deleted.');
}

// ─── Entry point ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (!CLIENT_ID || !CLIENT_SECRET || !COMPANY_ID) {
  console.error('Missing required env vars: PROCORE_CLIENT_ID, PROCORE_CLIENT_SECRET, PROCORE_COMPANY_ID');
  process.exit(1);
}

if (args[0] === '--register') {
  cmdRegister().catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === '--delete') {
  cmdDelete(args[1]).catch((e) => { console.error(e); process.exit(1); });
} else {
  cmdList().catch((e) => { console.error(e); process.exit(1); });
}
