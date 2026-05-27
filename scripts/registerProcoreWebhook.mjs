/**
 * registerProcoreWebhook.mjs
 *
 * Registers (or lists) Procore webhook hooks and triggers for this application.
 *
 * Usage:
 *   node scripts/registerProcoreWebhook.mjs                  # list existing hooks
 *   node scripts/registerProcoreWebhook.mjs --register       # register hook + triggers
 *   node scripts/registerProcoreWebhook.mjs --delete <hookId> # delete a hook
 *   node scripts/registerProcoreWebhook.mjs --cleanup [keepHookId] # delete old hooks in namespace
 *
 * Required env vars (loads .env then .env.local):
 *   PROCORE_CLIENT_ID
 *   PROCORE_CLIENT_SECRET
 *   PROCORE_COMPANY_ID
 *   PROCORE_WEBHOOK_SHARED_SECRET
 *   PROCORE_API_URL          (default: https://api.procore.com)
 *   PROCORE_TOKEN_URL        (default: https://api.procore.com/oauth/token)
 *   WEBHOOK_DESTINATION_URL  (override, default: https://analyticspmc.netlify.app/api/webhooks/procore)
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
const DESTINATION_URL = process.env.WEBHOOK_DESTINATION_URL || 'https://analyticspmc.netlify.app/api/webhooks/procore';
const WEBHOOK_NAMESPACE = process.env.PROCORE_WEBHOOK_NAMESPACE || 'pmc-analytics';
const ACTIVE_HOOK_ID = (process.env.PROCORE_WEBHOOK_HOOK_ID || '').trim();

// Desired resources; final trigger set is filtered to supported resources/actions.
const DESIRED_TRIGGERS = [
  { resourceName: 'Projects', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Bid Board Projects', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Estimating Projects', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Timecard Entries', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Productivity Logs', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Commitment Contracts', eventTypes: ['create', 'update', 'delete'] },
];

const RESOURCE_ALIASES = {
  'Projects': ['Projects'],
  'Bid Board Projects': ['Bid Board Projects', 'Bidboard Projects', 'Bid Board Projects V2'],
  'Estimating Projects': ['Estimating Projects', 'Bid Board Projects', 'Bidboard Projects', 'Projects'],
  'Timecard Entries': ['Timecard Entries', 'Timecards', 'Timecard Entries V2'],
  'Productivity Logs': ['Productivity Logs', 'Manpower Logs'],
  'Commitment Contracts': ['Commitment Contracts', 'Subcontracts'],
};

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
  const data = await apiGet(
    token,
    `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks?namespace=${encodeURIComponent(WEBHOOK_NAMESPACE)}`
  );
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function listTriggers(token, hookId) {
  const data = await apiGet(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks/${hookId}/triggers`);
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function listResourcesAll(token) {
  const perPage = 100;
  const maxPages = 20;
  const all = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await apiGet(
      token,
      `/rest/v2.0/companies/${COMPANY_ID}/webhooks/resources?payload_version=v2.0&page=${page}&per_page=${perPage}`
    );
    const items = Array.isArray(data?.data) ? data.data : [];
    if (!items.length) break;

    for (const item of items) {
      all.push({
        name: String(item?.name || '').trim(),
        actions: Array.isArray(item?.actions)
          ? item.actions.map((a) => String(a).trim().toLowerCase()).filter(Boolean)
          : [],
      });
    }

    if (items.length < perPage) break;
  }

  return all;
}

async function createHook(token) {
  return apiPost(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks`, {
    payload_version: 'v2.0',
    namespace: WEBHOOK_NAMESPACE,
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
    api_version: 'v2.0',
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

  const hooks = await listHooks(token);
  let hookId = '';
  const activeHook = ACTIVE_HOOK_ID ? hooks.find((hook) => String(hook?.id || '') === ACTIVE_HOOK_ID) : null;
  const matchingHook = hooks.find((hook) => {
    const destination = String(hook?.destination_url || '').trim();
    const namespace = String(hook?.namespace || '').trim();
    return destination === DESTINATION_URL && namespace === WEBHOOK_NAMESPACE;
  });

  if (activeHook) {
    hookId = String(activeHook.id || '').trim();
  } else if (matchingHook) {
    hookId = String(matchingHook.id || '').trim();
  }

  if (hookId) {
    console.log(`Reusing existing hook id=${hookId} → ${DESTINATION_URL}`);
  } else {
    console.log(`Creating hook → ${DESTINATION_URL}`);
    let hook;
    try {
      hook = await createHook(token);
    } catch (err) {
      console.error('Failed to create hook:', err.message);
      process.exit(1);
    }

    hookId = hook?.data?.id ?? hook?.id;
    if (!hookId) {
      console.error('Hook created but could not parse hook id from response:', JSON.stringify(hook));
      process.exit(1);
    }
    console.log(`Hook created: id=${hookId}`);
  }

  console.log('Fetching supported webhook resources...');
  const resourceCatalog = await listResourcesAll(token);
  const catalogByName = new Map(resourceCatalog.map((r) => [r.name.toLowerCase(), r]));

  let existingTriggers = [];
  try {
    existingTriggers = hookId ? await listTriggers(token, hookId) : [];
  } catch (err) {
    console.warn('Unable to read existing triggers for hook; proceeding without dedupe:', err.message);
  }
  const existingTriggerKeys = new Set(
    existingTriggers.map((t) => `${String(t.resource_name || '').toLowerCase()}::${String(t.event_type || '').toLowerCase()}`)
  );

  const triggerPlan = [];
  for (const desired of DESIRED_TRIGGERS) {
    const aliases = RESOURCE_ALIASES[desired.resourceName] || [desired.resourceName];
    const matched = aliases
      .map((alias) => catalogByName.get(alias.toLowerCase()))
      .find((item) => Boolean(item));

    if (!matched) {
      console.log(`  - skipping ${desired.resourceName}: not available for this company`);
      continue;
    }

    const allowed = new Set(matched.actions);
    const validEvents = desired.eventTypes
      .map((e) => e.toLowerCase())
      .filter((e) => allowed.has(e));

    if (!validEvents.length) {
      console.log(`  - skipping ${desired.resourceName}: no overlapping actions (available: ${matched.actions.join(',')})`);
      continue;
    }

    for (const eventType of validEvents) {
      const triggerKey = `${matched.name.toLowerCase()}::${eventType.toLowerCase()}`;
      if (existingTriggerKeys.has(triggerKey)) {
        continue;
      }
      triggerPlan.push({ resourceName: matched.name, eventType });
    }
  }

  if (!triggerPlan.length) {
    console.warn('No valid triggers matched your desired resources. Hook was created without triggers.');
  }

  let successCount = 0;
  for (const { resourceName, eventType } of triggerPlan) {
    try {
      const trigResult = await createTrigger(token, hookId, resourceName, eventType);
      const triggerId = trigResult?.data?.id ?? trigResult?.id ?? '?';
      console.log(`  ✓ trigger: ${resourceName} / ${eventType} (id=${triggerId})`);
      successCount++;
    } catch (err) {
      console.warn(`  ✗ trigger failed (${resourceName} / ${eventType}): ${err.message}`);
    }
  }

  console.log(`\nDone. Hook id=${hookId}, ${successCount} triggers registered.`);
  console.log('\nNext steps:');
  console.log('  1. Add PROCORE_WEBHOOK_SHARED_SECRET to Netlify environment variables.');
  console.log('  2. Add PROCORE_SYNC_SECRET to Netlify environment variables.');
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

async function cmdCleanup(optionalKeepHookId) {
  const keepHookId = String(optionalKeepHookId || ACTIVE_HOOK_ID || '').trim();
  if (!keepHookId) {
    console.error('Usage: node scripts/registerProcoreWebhook.mjs --cleanup [keepHookId]');
    console.error('No keep hook id provided, and PROCORE_WEBHOOK_HOOK_ID is not set. Aborting for safety.');
    process.exit(1);
  }

  console.log('Fetching access token...');
  const token = await getToken();
  const hooks = await listHooks(token);

  if (!hooks.length) {
    console.log('No hooks found for namespace', WEBHOOK_NAMESPACE);
    return;
  }

  const toDelete = hooks.filter((hook) => String(hook?.id || '') !== keepHookId);
  if (!toDelete.length) {
    console.log(`Nothing to clean up. Only keep hook remains: ${keepHookId}`);
    return;
  }

  console.log(`Keeping hook ${keepHookId}; deleting ${toDelete.length} old hook(s)...`);
  let deletedCount = 0;
  for (const hook of toDelete) {
    const hookId = String(hook?.id || '').trim();
    if (!hookId) continue;
    try {
      await deleteHook(token, hookId);
      deletedCount++;
      console.log(`  ✓ deleted hook ${hookId}`);
    } catch (err) {
      console.warn(`  ✗ failed to delete hook ${hookId}: ${err.message}`);
    }
  }

  console.log(`Cleanup done. Deleted ${deletedCount}/${toDelete.length} old hook(s).`);
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
} else if (args[0] === '--cleanup') {
  cmdCleanup(args[1]).catch((e) => { console.error(e); process.exit(1); });
} else {
  cmdList().catch((e) => { console.error(e); process.exit(1); });
}
