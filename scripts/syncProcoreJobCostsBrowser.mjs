import { appendFile, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const DEFAULT_JOB_COST_URL =
  'https://us02.procore.com/598134325805519/company/erp_integrations/job_costs';
export const DEFAULT_TEST_PROJECT_ID = '598134326669479';
export const DEFAULT_TEST_PROJECT_NAME = 'TAD-001 - ToddandDave cost code test';
const DEFAULT_DELAY_SECONDS = 15;
const JOB_SELECT = '#active_synced_projects';
const SYNC_BUTTON = 'Sync Job Costs for Selected Job';
const SUCCESS_MESSAGE = 'Job Costs Will Begin Syncing';

function usage() {
  console.log(`Sync Procore QuickBooks Online job costs through Procore's built-in UI.

Usage:
  npm run procore:job-costs
  npm run procore:job-costs -- --dry-run
  npm run procore:job-costs -- --resume logs\\prior-run.jsonl

Options:
  --delay SECONDS       Delay after each accepted project (default: 15)
  --dry-run             List projects without sending sync requests
  --resume PATH         Skip projects accepted in a prior JSONL audit log
  --skip VALUE          Skip an exact project ID or name; may be repeated
  --include-test        Include the ToddandDave test project
  --url URL             Override the Procore Job Costs page URL
  --profile PATH        Override the persistent Edge profile directory
  --log-dir PATH        Override the audit-log directory (default: ./logs)
  --login-timeout SEC   Login/MFA timeout (default: 600)
  --keep-open           Leave Edge open when finished
  --help                Show this help

Enter passwords and MFA only in the Edge window.`);
}

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function numericOption(value, name, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new Error(`${name} must be ${allowZero ? 'zero or positive' : 'positive'}.`);
  }
  return number;
}

export function parseArgs(argv, env = process.env) {
  const options = {
    delaySeconds: DEFAULT_DELAY_SECONDS,
    dryRun: false,
    includeTest: false,
    keepOpen: false,
    help: false,
    jobCostUrl: env.PROCORE_JOB_COST_URL || DEFAULT_JOB_COST_URL,
    profileDir:
      env.PROCORE_JOB_COST_PROFILE ||
      path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Codex', 'ProcoreJobCostBrowserProfile'),
    logDir: path.resolve(env.PROCORE_JOB_COST_LOG_DIR || 'logs'),
    loginTimeoutSeconds: 600,
    resumePath: '',
    skips: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [name, inlineValue] = argument.split(/=(.*)/s, 2);
    const value = () => inlineValue ?? optionValue(argv, index++, name);
    switch (name) {
      case '--delay': options.delaySeconds = numericOption(value(), name, true); break;
      case '--dry-run': options.dryRun = true; break;
      case '--include-test': options.includeTest = true; break;
      case '--keep-open': options.keepOpen = true; break;
      case '--help':
      case '-h': options.help = true; break;
      case '--url': options.jobCostUrl = value(); break;
      case '--profile': options.profileDir = path.resolve(value()); break;
      case '--log-dir': options.logDir = path.resolve(value()); break;
      case '--login-timeout': options.loginTimeoutSeconds = numericOption(value(), name); break;
      case '--resume': options.resumePath = path.resolve(value()); break;
      case '--skip': options.skips.push(value()); break;
      default: throw new Error(`Unknown option: ${argument}`);
    }
  }

  const url = new URL(options.jobCostUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('procore.com')) {
    throw new Error('--url must be an HTTPS procore.com URL.');
  }
  if (!url.pathname.endsWith('/company/erp_integrations/job_costs')) {
    throw new Error('--url must point to the company ERP Integrations Job Costs page.');
  }
  return options;
}

const normalized = (value) => String(value || '').trim().toLowerCase();

export function filterPendingJobs(jobs, options, resumedIds = new Set()) {
  const skips = new Set(options.skips.map(normalized));
  return jobs.filter((job) => {
    if (resumedIds.has(job.id)) return false;
    if (!options.includeTest &&
      (job.id === DEFAULT_TEST_PROJECT_ID || normalized(job.name) === normalized(DEFAULT_TEST_PROJECT_NAME))) return false;
    return !skips.has(normalized(job.id)) && !skips.has(normalized(job.name));
  });
}

export function queuedIdsFromJsonl(raw) {
  const ids = new Set();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on resume log line ${index + 1}: ${error.message}`);
    }
    if (['queued', 'accepted_unconfirmed'].includes(entry.event) && entry.jobId) ids.add(String(entry.jobId));
  }
  return ids;
}

function fileTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
}

async function findJobCostsPage(context, targetUrl, timeoutMs) {
  let page = context.pages().find((candidate) => candidate.url().includes('/company/erp_integrations/job_costs'));
  if (!page) page = context.pages().find((candidate) => candidate.url() === 'about:blank') || await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + timeoutMs;
  let prompted = false;
  let retried = false;
  while (Date.now() < deadline) {
    for (const candidate of context.pages()) {
      if (await candidate.locator(JOB_SELECT).count()) return candidate;
    }
    const active = context.pages().at(-1) || page;
    const hostname = new URL(active.url()).hostname;
    if (hostname === 'login.procore.com' && !prompted) {
      console.log('\nComplete the Procore login and MFA in Edge. Credentials are never read or logged.');
      prompted = true;
    } else if (hostname.endsWith('procore.com') && hostname !== 'login.procore.com' && !retried) {
      retried = true;
      await active.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out after ${timeoutMs / 1000} seconds waiting for the Procore Job Costs page.`);
}

async function syncOneJob(page, job, jobCostUrl) {
  await page.locator(JOB_SELECT).selectOption(job.id);
  if (await page.locator(JOB_SELECT).inputValue() !== job.id) throw new Error('Project selection did not stick.');
  await page.waitForTimeout(350);

  const baseUrl = new URL(jobCostUrl);
  const refreshPath = `${baseUrl.pathname}/refresh`;
  const refreshPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === baseUrl.origin && url.pathname === refreshPath &&
      url.searchParams.get('active_synced_projects') === job.id;
  }, { timeout: 30_000 });
  const finalPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === baseUrl.origin && url.pathname === baseUrl.pathname && response.status() === 200;
  }, { timeout: 30_000 });

  await page.getByRole('button', { name: SYNC_BUTTON, exact: true }).click();
  const [refresh, final] = await Promise.all([refreshPromise, finalPromise]);
  await page.waitForLoadState('domcontentloaded');
  if (refresh.status() !== 302) throw new Error(`Unexpected refresh response: HTTP ${refresh.status()}.`);

  let confirmationSeen = false;
  try {
    await page.waitForFunction((message) => document.body.innerText.includes(message), SUCCESS_MESSAGE, { timeout: 10_000 });
    confirmationSeen = true;
  } catch (error) {
    if (error.name !== 'TimeoutError' && !error.message.includes('Timeout')) throw error;
  }
  return { refreshStatus: refresh.status(), finalStatus: final.status(), confirmationSeen };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();

  const { chromium } = await import('playwright-core');
  const delayMs = Math.round(options.delaySeconds * 1000);
  const resumedIds = options.resumePath ? queuedIdsFromJsonl(await readFile(options.resumePath, 'utf8')) : new Set();
  await mkdir(options.logDir, { recursive: true });
  await mkdir(options.profileDir, { recursive: true });
  const delayLabel = options.delaySeconds.toString().replace('.', 'p');
  const logPath = path.join(options.logDir, `procore-job-cost-sync-${delayLabel}s-${fileTimestamp()}.jsonl`);
  const audit = async (entry) => appendFile(logPath, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');

  console.log(`Opening Edge with profile: ${options.profileDir}`);
  const context = await chromium.launchPersistentContext(options.profileDir, {
    channel: 'msedge', headless: false, viewport: null, args: ['--start-maximized', '--no-first-run'],
  });
  const handleDialogs = (page) => page.on('dialog', async (dialog) => {
    await audit({ event: 'dialog', type: dialog.type(), message: dialog.message() });
    await dialog.accept();
  });
  context.pages().forEach(handleDialogs);
  context.on('page', handleDialogs);

  let interrupted = false;
  const interrupt = () => { interrupted = true; console.log('\nStopping safely after the current action...'); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    const page = await findJobCostsPage(context, options.jobCostUrl, options.loginTimeoutSeconds * 1000);
    await page.locator(`${JOB_SELECT} option`).first().waitFor({ state: 'attached', timeout: 30_000 });
    const jobs = await page.locator(`${JOB_SELECT} option`).evaluateAll((items) =>
      items.map((item) => ({ id: item.value, name: item.textContent.trim() })),
    );
    const pending = filterPendingJobs(jobs, options, resumedIds);
    const pendingIds = new Set(pending.map((job) => job.id));
    const resumed = jobs.filter((job) => resumedIds.has(job.id)).length;
    const excluded = jobs.filter((job) => !pendingIds.has(job.id) && !resumedIds.has(job.id)).length;
    console.log(`\nFound ${jobs.length} projects: ${pending.length} pending, ${resumed} resumed, ${excluded} excluded.`);

    if (options.dryRun) {
      console.log('\nDry run only—no sync requests will be sent:');
      pending.forEach((job, index) => console.log(`${index + 1}. ${job.name} (${job.id})`));
      return;
    }
    if (!pending.length) return console.log('Nothing to sync.');

    await audit({ event: 'start', totalDropdownJobs: jobs.length, pending: pending.length,
      delayBetweenProjectsMs: delayMs, excludedTestProject: !options.includeTest,
      explicitSkips: options.skips, resumedFrom: options.resumePath || null,
      resumedJobCount: resumedIds.size, jobCostUrl: options.jobCostUrl });
    console.log(`Starting in 5 seconds. Press Ctrl+C to cancel. Audit log: ${logPath}`);
    await page.waitForTimeout(5000);

    let completed = 0;
    let previousAcceptedAt = null;
    for (const job of pending) {
      if (interrupted) break;
      try {
        const statuses = await syncOneJob(page, job, options.jobCostUrl);
        const now = Date.now();
        completed += 1;
        await audit({ event: 'queued', number: completed, of: pending.length, jobId: job.id,
          job: job.name, ...statuses, confirmation: statuses.confirmationSeen ? SUCCESS_MESSAGE : null,
          millisecondsSincePreviousConfirmation: previousAcceptedAt === null ? null : now - previousAcceptedAt });
        previousAcceptedAt = now;
        console.log(`[${completed}/${pending.length}] Queued ${job.name}${statuses.confirmationSeen ? '' : ' (accepted; banner not observed)'}`);
        if (completed < pending.length && !interrupted) {
          await audit({ event: 'delay', afterJobNumber: completed, delayMs });
          await page.waitForTimeout(delayMs);
        }
      } catch (error) {
        await audit({ event: 'error', number: completed + 1, of: pending.length,
          jobId: job.id, job: job.name, error: error.message });
        throw error;
      }
    }

    if (interrupted) {
      await audit({ event: 'interrupted', queuedThisRun: completed, pending: pending.length - completed });
      console.log(`Stopped after ${completed} projects. Resume with --resume "${logPath}".`);
      process.exitCode = 130;
      return;
    }
    await audit({ event: 'complete', queuedThisRun: completed,
      delayBetweenProjectsMs: delayMs, totalDropdownJobs: jobs.length });
    console.log(`\nCompleted: ${completed} projects queued successfully.`);
    console.log(`Audit log: ${logPath}`);
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (!options.keepOpen) await context.close();
  }
}

const directRun = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (directRun) main().catch((error) => {
  console.error(`Procore job-cost sync failed: ${error.message}`);
  process.exitCode = 1;
});
