/**
 * registerProcoreWebhook.mjs
 *
 * Registers (or lists) Procore webhook hooks and triggers for this application.
 *
 * Procore has two webhook catalogs. Company-level hooks only receive company/
 * portfolio resources (Projects, Company Users, ...). Project-tool resources
 * (RFIs, Task Items, Meetings, change orders, timecards, ...) must be registered
 * on a hook per project. The trigger plan lives in src/lib/procoreWebhookPlan.js
 * and is shared with the onboarding worker.
 *
 * Usage:
 *   node scripts/registerProcoreWebhook.mjs                  # list company hook(s)
 *   node scripts/registerProcoreWebhook.mjs --resources [payloadVersion] [projectId]
 *                                                            # dump webhook resource catalog (company, or project when projectId given)
 *   node scripts/registerProcoreWebhook.mjs --register       # register company hook + triggers
 *   node scripts/registerProcoreWebhook.mjs --register-project <projectId> [--groups priority,actuals]
 *                                                            # register one project hook + triggers
 *   node scripts/registerProcoreWebhook.mjs --register-projects [--groups priority] [--limit N] [--dry-run] [--pace-ms 1100]
 *                                                            # register hooks for all active pmc_projects (paced, idempotent, resumable)
 *   node scripts/registerProcoreWebhook.mjs --list-project <projectId>   # list a project's hooks + triggers
 *   node scripts/registerProcoreWebhook.mjs --delete <hookId> # delete a company hook
 *   node scripts/registerProcoreWebhook.mjs --cleanup [keepHookId] # delete old company hooks in namespace
 *
 * Required env vars (loads .env then .env.local):
 *   PROCORE_CLIENT_ID
 *   PROCORE_CLIENT_SECRET
 *   PROCORE_COMPANY_ID
 *   PROCORE_WEBHOOK_SHARED_SECRET
 *   DATABASE_URL             (only for --register-projects)
 *   PROCORE_API_URL          (default: https://api.procore.com)
 *   PROCORE_TOKEN_URL        (default: https://api.procore.com/oauth/token)
 *   WEBHOOK_DESTINATION_URL  (override, default: https://analyticspmc.netlify.app/api/webhooks/procore)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  COMPANY_WEBHOOK_TRIGGER_PLAN,
  WEBHOOK_PAYLOAD_VERSION,
  projectWebhookPlanForGroups,
  resolveProjectWebhookGroups,
  resolveTriggerPlan,
  triggerKeySet,
} from '../src/lib/procoreWebhookPlan.js';

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function flagValue(args, name, fallback) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  return value === undefined || value.startsWith('--') ? fallback : value;
}

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
  return procoreFetch(token, 'GET', path);
}

async function apiPost(token, path, payload) {
  return procoreFetch(token, 'POST', path, payload);
}

async function apiDelete(token, path) {
  return procoreFetch(token, 'DELETE', path);
}

// Procore's window is hourly; on 429 wait for x-rate-limit-reset (bounded)
// rather than failing a long paced run. Set WEBHOOK_MAX_429_WAIT_MS=0 to fail fast.
const MAX_429_WAIT_MS = Number(process.env.WEBHOOK_MAX_429_WAIT_MS ?? 20 * 60_000);

// Long paced runs outlive the 1h client-credentials token; refresh on 401.
let _refreshedToken = null;

async function procoreFetch(token, method, path, payload, attempt = 0) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${_refreshedToken || token}`,
      'Procore-Company-Id': COMPANY_ID,
      Accept: 'application/json',
      ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });

  if (res.status === 401 && attempt < 1) {
    await res.text().catch(() => '');
    console.warn('  401 - access token expired; fetching a fresh token...');
    _refreshedToken = await getToken();
    return procoreFetch(token, method, path, payload, attempt + 1);
  }

  if (res.status === 429 && attempt < 2 && MAX_429_WAIT_MS > 0) {
    const resetSec = Number(res.headers.get('x-rate-limit-reset'));
    const retryAfterSec = Number(res.headers.get('retry-after'));
    const waitMs = Math.min(
      MAX_429_WAIT_MS,
      Math.max(
        5_000,
        Number.isFinite(resetSec) && resetSec > 0 ? resetSec * 1000 - Date.now() + 2_000 : 0,
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : 0,
      ),
    );
    await res.text().catch(() => '');
    console.warn(`  429 on ${method} ${path.split('?')[0]} - waiting ${Math.round(waitMs / 1000)}s for the Procore window to reset...`);
    await sleep(waitMs);
    return procoreFetch(token, method, path, payload, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} failed ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
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
  const data = await apiGet(token, `/rest/v2.0/companies/${COMPANY_ID}/webhooks/hooks/${hookId}/triggers?page=1&per_page=100`);
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function listResourcesAll(token, payloadVersion = 'v2.0', projectId = '') {
  const perPage = 100;
  const maxPages = 20;
  const all = [];
  const versionParam = payloadVersion ? `payload_version=${encodeURIComponent(payloadVersion)}&` : '';
  const scope = projectId
    ? `/rest/v2.0/companies/${COMPANY_ID}/projects/${encodeURIComponent(projectId)}/webhooks/resources`
    : `/rest/v2.0/companies/${COMPANY_ID}/webhooks/resources`;

  for (let page = 1; page <= maxPages; page++) {
    const data = await apiGet(
      token,
      `${scope}?${versionParam}page=${page}&per_page=${perPage}`
    );
    const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    if (!items.length) break;

    for (const item of items) {
      all.push({
        name: String(item?.name || '').trim(),
        actions: Array.isArray(item?.actions)
          ? item.actions.map((a) => String(a).trim().toLowerCase()).filter(Boolean)
          : [],
        payloadVersion: String(item?.payload_version || '').trim(),
        tool: String(item?.tool || item?.category || '').trim(),
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

// ─── Project-level hook & trigger operations ─────────────────────────────────

function projectBase(projectId) {
  return `/rest/v2.0/companies/${COMPANY_ID}/projects/${encodeURIComponent(projectId)}/webhooks`;
}

async function listProjectHooks(token, projectId) {
  const data = await apiGet(
    token,
    `${projectBase(projectId)}/hooks?namespace=${encodeURIComponent(WEBHOOK_NAMESPACE)}`
  );
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function listProjectTriggers(token, projectId, hookId) {
  const data = await apiGet(token, `${projectBase(projectId)}/hooks/${hookId}/triggers?page=1&per_page=100`);
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function createProjectHook(token, projectId) {
  return apiPost(token, `${projectBase(projectId)}/hooks`, {
    payload_version: WEBHOOK_PAYLOAD_VERSION,
    namespace: WEBHOOK_NAMESPACE,
    destination_url: DESTINATION_URL,
    destination_headers: {
      Authorization: `Bearer ${SHARED_SECRET}`,
    },
  });
}

async function createProjectTrigger(token, projectId, hookId, resourceName, eventType) {
  return apiPost(token, `${projectBase(projectId)}/hooks/${hookId}/triggers`, {
    resource_name: resourceName,
    event_type: eventType,
    api_version: WEBHOOK_PAYLOAD_VERSION,
  });
}

/**
 * Idempotently ensure one project has a namespace hook carrying the requested
 * trigger groups. Returns counts so the bulk command can report progress.
 * `paceMs` spaces every Procore request to stay well under the hourly quota.
 */
async function ensureProjectHook(token, projectId, { groups, dryRun = false, paceMs = 0, catalogCache = null } = {}) {
  const wait = () => (paceMs > 0 ? sleep(paceMs) : Promise.resolve());

  const hooks = await listProjectHooks(token, projectId);
  await wait();
  let hook = hooks.find((h) => String(h?.destination_url || '').trim() === DESTINATION_URL)
    || hooks[0]
    || null;
  let hookCreated = false;

  if (!hook && !dryRun) {
    const created = await createProjectHook(token, projectId);
    await wait();
    hook = created?.data ?? created;
    hookCreated = true;
  }
  const hookId = hook?.id != null ? String(hook.id) : null;

  // The project catalog is identical across projects with the same tool set;
  // reuse one fetch for the bulk run to save ~1 request per project.
  let catalog = catalogCache?.value || null;
  if (!catalog) {
    catalog = await listResourcesAll(token, WEBHOOK_PAYLOAD_VERSION, projectId);
    await wait();
    if (catalogCache) catalogCache.value = catalog;
  }

  const existingTriggers = hookId ? await listProjectTriggers(token, projectId, hookId) : [];
  if (hookId) await wait();

  const { planned, resolution } = resolveTriggerPlan(
    projectWebhookPlanForGroups(groups),
    catalog,
    triggerKeySet(existingTriggers),
  );

  let created = 0;
  const failures = [];
  if (!dryRun && hookId) {
    for (const { resourceName, eventType } of planned) {
      try {
        await createProjectTrigger(token, projectId, hookId, resourceName, eventType);
        created++;
      } catch (err) {
        failures.push(`${resourceName}/${eventType}: ${err.message}`);
        if (/\b429\b/.test(err.message)) throw err;
      }
      await wait();
    }
  }

  return {
    projectId,
    hookId,
    hookCreated,
    existing: existingTriggers.length,
    planned: planned.length,
    created,
    failures,
    unavailable: resolution.filter((r) => r.reason).map((r) => `${r.requested} (${r.reason})`),
  };
}

async function loadActiveProjectIds(limit) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      `
        SELECT procore_project_id AS id, project_name AS name
        FROM pmc_projects
        WHERE company_id = $1
          AND lower(COALESCE(status, '')) NOT LIKE '%complete%'
          AND lower(COALESCE(status, '')) NOT LIKE '%closed%'
          AND lower(COALESCE(status, '')) NOT LIKE '%cancel%'
        ORDER BY procore_updated_at DESC NULLS LAST, project_name
        ${limit ? `LIMIT ${Number(limit)}` : ''}
      `,
      COMPANY_ID,
    );
    return rows.map((r) => ({ id: String(r.id), name: String(r.name || '') }));
  } finally {
    await prisma.$disconnect();
  }
}

async function cmdListProject(projectId) {
  if (!projectId) {
    console.error('Usage: --list-project <projectId>');
    process.exit(1);
  }
  console.log('Fetching access token...');
  const token = await getToken();
  const hooks = await listProjectHooks(token, projectId);
  console.log(`${hooks.length} hook(s) in namespace ${WEBHOOK_NAMESPACE} for project ${projectId}`);
  for (const hook of hooks) {
    console.log(`\nHook id=${hook.id}`);
    console.log(`  destination: ${hook.destination_url}`);
    console.log(`  status:      ${hook.status}`);
    const triggers = await listProjectTriggers(token, projectId, hook.id);
    console.log(triggers.length ? '  triggers:' : '  triggers: (none)');
    for (const t of triggers) console.log(`    - ${t.resource_name} / ${t.event_type}`);
  }
}

async function cmdRegisterProject(projectId, args) {
  if (!projectId) {
    console.error('Usage: --register-project <projectId> [--groups priority,actuals]');
    process.exit(1);
  }
  if (!SHARED_SECRET) {
    console.error('ERROR: PROCORE_WEBHOOK_SHARED_SECRET is not set');
    process.exit(1);
  }
  const groups = resolveProjectWebhookGroups(flagValue(args, '--groups', ''));
  const dryRun = args.includes('--dry-run');
  console.log('Fetching access token...');
  const token = await getToken();
  console.log(`${dryRun ? '[dry-run] ' : ''}Ensuring project hook for ${projectId} (groups=${groups.join(',')}) → ${DESTINATION_URL}`);
  const result = await ensureProjectHook(token, projectId, { groups, dryRun, paceMs: 300 });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdRegisterProjects(args) {
  if (!SHARED_SECRET) {
    console.error('ERROR: PROCORE_WEBHOOK_SHARED_SECRET is not set');
    process.exit(1);
  }
  const groups = resolveProjectWebhookGroups(flagValue(args, '--groups', ''));
  const limit = Number(flagValue(args, '--limit', '0')) || 0;
  const paceMs = Math.max(0, Number(flagValue(args, '--pace-ms', '1100')) || 1100);
  const dryRun = args.includes('--dry-run');

  console.log('Loading active projects from pmc_projects...');
  const projects = await loadActiveProjectIds(limit);
  console.log(`${projects.length} project(s) selected. groups=${groups.join(',')} pace=${paceMs}ms${dryRun ? ' [dry-run]' : ''}`);

  console.log('Fetching access token...');
  const token = await getToken();
  const catalogCache = { value: null };
  const totals = { hooksCreated: 0, triggersCreated: 0, alreadyCurrent: 0, failed: 0 };

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const label = `[${i + 1}/${projects.length}] ${project.id} ${project.name}`.trim();
    try {
      const result = await ensureProjectHook(token, project.id, { groups, dryRun, paceMs, catalogCache });
      totals.hooksCreated += result.hookCreated ? 1 : 0;
      totals.triggersCreated += result.created;
      if (!result.hookCreated && result.planned === 0) totals.alreadyCurrent++;
      if (result.failures.length) totals.failed++;
      const summary = dryRun
        ? `would create hook=${!result.hookId} triggers=${result.planned}`
        : `hook=${result.hookCreated ? 'created' : 'existing'} triggers +${result.created}/${result.planned} (had ${result.existing})`;
      console.log(`${label}: ${summary}${result.failures.length ? ` FAILURES: ${result.failures.join('; ')}` : ''}`);
      if (i === 0 && result.unavailable.length) {
        console.log(`  unavailable in project catalog: ${result.unavailable.join('; ')}`);
      }
    } catch (err) {
      totals.failed++;
      console.error(`${label}: ERROR ${err.message}`);
      if (/\b429\b/.test(err.message)) {
        console.error('Procore rate limit reached; stopping. Re-run later — the command is idempotent and resumes where it left off.');
        break;
      }
    }
  }

  console.log(`\nDone. hooksCreated=${totals.hooksCreated} triggersCreated=${totals.triggersCreated} alreadyCurrent=${totals.alreadyCurrent} failed=${totals.failed}`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdResources(payloadVersion, projectId) {
  console.log('Fetching access token...');
  const token = await getToken();
  const version = payloadVersion === 'all' ? '' : (payloadVersion || 'v2.0');
  const scopeLabel = projectId ? `project ${projectId}` : `company ${COMPANY_ID}`;
  console.log(`Webhook resource catalog for ${scopeLabel}${version ? ` (payload_version=${version})` : ' (all payload versions)'}`);
  const resources = await listResourcesAll(token, version, projectId || '');
  if (!resources.length) {
    console.log('No resources returned.');
    return;
  }
  resources.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of resources) {
    console.log(`  - ${r.name}  [${r.actions.join(',')}]${r.payloadVersion ? `  payload=${r.payloadVersion}` : ''}${r.tool ? `  tool=${r.tool}` : ''}`);
  }
  console.log(`\n${resources.length} resource(s).`);
}

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

  let existingTriggers = [];
  try {
    existingTriggers = hookId ? await listTriggers(token, hookId) : [];
  } catch (err) {
    console.warn('Unable to read existing triggers for hook; proceeding without dedupe:', err.message);
  }

  const { planned: triggerPlan, resolution } = resolveTriggerPlan(
    COMPANY_WEBHOOK_TRIGGER_PLAN,
    resourceCatalog,
    triggerKeySet(existingTriggers),
  );
  for (const entry of resolution) {
    if (entry.reason) console.log(`  - skipping ${entry.requested}: ${entry.reason}`);
  }

  if (!triggerPlan.length && existingTriggers.length === 0) {
    console.warn('No valid triggers matched your desired resources. Hook has no triggers.');
  } else if (!triggerPlan.length) {
    console.log(`All ${existingTriggers.length} supported trigger(s) are already registered.`);
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

  console.log(`\nDone. Hook id=${hookId}, ${existingTriggers.length} existing trigger(s), ${successCount} new trigger(s).`);
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
} else if (args[0] === '--register-project') {
  cmdRegisterProject(args[1], args.slice(2)).catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === '--register-projects') {
  cmdRegisterProjects(args.slice(1)).catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === '--list-project') {
  cmdListProject(args[1]).catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === '--resources') {
  cmdResources(args[1], args[2]).catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === '--delete') {
  cmdDelete(args[1]).catch((e) => { console.error(e); process.exit(1); });
} else if (args[0] === '--cleanup') {
  cmdCleanup(args[1]).catch((e) => { console.error(e); process.exit(1); });
} else {
  cmdList().catch((e) => { console.error(e); process.exit(1); });
}
