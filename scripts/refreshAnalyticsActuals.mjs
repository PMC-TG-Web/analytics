/**
 * Refresh the analytics page's Procore budget + actuals data without relying on
 * Procore webhooks. Intended for controlled operator runs against a local Next
 * dev/server instance that points at the production database.
 *
 * Example:
 *   node scripts/refreshAnalyticsActuals.mjs --base=http://localhost:3000 --start=2025-08-01 --end=2026-07-09
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

function loadEnvFile(filePath, override = false) {
  try {
    const text = readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (override || !process.env[key]) process.env[key] = value;
    }
  } catch {
    // Optional env file.
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Avoid a dependency on dotenv for this operational script.
loadEnvFile(resolve(root, '.env'));
loadEnvFile(resolve(root, '.env.local'), true);

const prisma = new PrismaClient();

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    options[key] = rest.length ? rest.join('=') : 'true';
  }
  return options;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toDateKey(date) {
  return date.toISOString().split('T')[0];
}

function normalizeDate(value, fallback) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson({ baseUrl, path, syncSecret, body }) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sync-secret': syncSecret,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 2000);
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

function compactStep(step) {
  const detail = step?.detail && typeof step.detail === 'object' ? step.detail : {};
  return {
    step: step?.step,
    status: step?.status,
    httpStatus: step?.httpStatus,
    totalEntriesFetched: detail.totalEntriesFetched,
    totalEntriesSaved: detail.totalEntriesSaved,
    totalLogsFetched: detail.totalLogsFetched,
    totalLogsSaved: detail.totalLogsSaved,
    errors: Array.isArray(detail.errors) ? detail.errors.slice(0, 3) : undefined,
    error: detail.error,
    details: detail.details,
  };
}

function summarizeActualsResponse(result) {
  const body = result.body && typeof result.body === 'object' ? result.body : {};
  return {
    ok: result.ok,
    status: result.status,
    success: body.success,
    totalMs: body.totalMs,
    selectedProjectIds: body.selectedProjectIds,
    steps: Array.isArray(body.steps) ? body.steps.map(compactStep) : undefined,
    error: body.error,
  };
}

function summarizeBudgetResponse(result) {
  const body = result.body && typeof result.body === 'object' ? result.body : {};
  return {
    ok: result.ok,
    status: result.status,
    success: body.success,
    projectsScanned: body.projectsScanned,
    fetched: body.fetched,
    upserted: body.upserted,
    warnings: Array.isArray(body.warnings) ? body.warnings.slice(0, 3) : undefined,
    errors: Array.isArray(body.errors) ? body.errors.slice(0, 3) : undefined,
    error: body.error,
    details: body.details,
  };
}

function summarizePurchaseOrderDetailResponse(result) {
  const body = result.body && typeof result.body === 'object' ? result.body : {};
  return {
    ok: result.ok,
    status: result.status,
    success: body.success,
    projectsWithPurchaseOrderContracts: body.projectsWithPurchaseOrderContracts,
    totalPurchaseOrderContractsFetched: body.totalPurchaseOrderContractsFetched,
    totalLineItemContractDetailsFetched: body.totalLineItemContractDetailsFetched,
    totalLineItemContractDetailsSaved: body.totalLineItemContractDetailsSaved,
    errors: Array.isArray(body.errors) ? body.errors.slice(0, 3) : undefined,
    error: body.error,
    details: body.details,
  };
}

async function getBudgetedProjects(companyId, explicitProjectIds) {
  if (explicitProjectIds.length) {
    return prisma.$queryRawUnsafe(
      `
        SELECT b.project_id,
               COALESCE(MAX(p.project_name), MAX(ps.name), b.project_id) AS project_name,
               COUNT(*)::text AS budget_lines
        FROM budgetlineitems b
        LEFT JOIN pmc_projects p
          ON p.company_id = b.company_id
         AND p.procore_project_id = b.project_id
        LEFT JOIN procore_project_staging ps
          ON ps.company_id = b.company_id
         AND ps.procore_project_id = b.project_id
        WHERE b.company_id = $1
          AND b.project_id = ANY($2::text[])
        GROUP BY b.project_id
        ORDER BY project_name ASC
      `,
      companyId,
      explicitProjectIds
    );
  }

  return prisma.$queryRawUnsafe(
    `
      SELECT b.project_id,
             COALESCE(MAX(p.project_name), MAX(ps.name), b.project_id) AS project_name,
             COUNT(*)::text AS budget_lines
      FROM budgetlineitems b
      LEFT JOIN pmc_projects p
        ON p.company_id = b.company_id
       AND p.procore_project_id = b.project_id
      LEFT JOIN procore_project_staging ps
        ON ps.company_id = b.company_id
       AND ps.procore_project_id = b.project_id
      WHERE b.company_id = $1
        AND b.project_id IS NOT NULL
        AND b.project_id <> ''
      GROUP BY b.project_id
      ORDER BY project_name ASC
    `,
    companyId
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const companyId = String(args.companyId || process.env.PROCORE_COMPANY_ID || '').trim();
  const syncSecret = String(process.env.PROCORE_SYNC_SECRET || '').trim();
  const baseUrl = String(args.base || 'http://localhost:3000').replace(/\/$/, '');
  const endDate = normalizeDate(args.end, toDateKey(new Date()));
  const startDate = normalizeDate(args.start, '2025-08-01');
  const delayMs = Math.max(0, Number.parseInt(String(args.delayMs || '750'), 10) || 750);
  const perPage = Math.min(200, Math.max(1, Number.parseInt(String(args.perPage || '100'), 10) || 100));
  const skipBudget = args.skipBudget === 'true';
  const explicitProjectIds = parseCsv(args.projectIds);

  if (!companyId) throw new Error('Missing PROCORE_COMPANY_ID.');
  if (!syncSecret) throw new Error('Missing PROCORE_SYNC_SECRET.');

  const projects = await getBudgetedProjects(companyId, explicitProjectIds);
  if (!projects.length) throw new Error('No budgeted projects found to refresh.');

  const runStartedAt = new Date();
  const results = [];

  console.log(`[refresh] base=${baseUrl} company=${companyId} projects=${projects.length} window=${startDate}..${endDate}`);

  for (const [index, project] of projects.entries()) {
    const projectId = String(project.project_id || '').trim();
    const projectName = String(project.project_name || projectId).trim();
    const prefix = `[refresh] ${index + 1}/${projects.length} ${projectName} (${projectId})`;
    const item = {
      projectId,
      projectName,
      budgetLines: Number(project.budget_lines || 0),
      budget: null,
      purchaseOrderLineItemDetails: null,
      actuals: null,
    };

    console.log(`${prefix} starting`);

    if (!skipBudget) {
      const budgetResult = await requestJson({
        baseUrl,
        path: '/api/procore/sync/budget-line-items',
        syncSecret,
        body: {
          companyId,
          projectIds: [projectId],
          fetchAll: true,
          perPage,
          forceUserOAuth: false,
        },
      });
      item.budget = summarizeBudgetResponse(budgetResult);
      console.log(`${prefix} budget status=${budgetResult.status} upserted=${item.budget.upserted ?? '?'} fetched=${item.budget.fetched ?? '?'}`);
      await sleep(delayMs);
    }

    const purchaseOrderDetailResult = await requestJson({
      baseUrl,
      path: '/api/procore/sync/purchase-order-line-item-details',
      syncSecret,
      body: {
        companyId,
        projectIds: [projectId],
        perPage,
        concurrency: 1,
        forceUserOAuth: false,
        persist: true,
      },
    });
    item.purchaseOrderLineItemDetails = summarizePurchaseOrderDetailResponse(purchaseOrderDetailResult);
    console.log(
      `${prefix} po-details status=${purchaseOrderDetailResult.status} saved=${item.purchaseOrderLineItemDetails.totalLineItemContractDetailsSaved ?? '?'}`
    );
    await sleep(delayMs);

    const actualsResult = await requestJson({
      baseUrl,
      path: '/api/cron/actuals',
      syncSecret,
      body: {
        companyId,
        projectIds: [projectId],
        startDate,
        endDate,
        perPage,
      },
    });
    item.actuals = summarizeActualsResponse(actualsResult);
    const timecardStep = item.actuals.steps?.find((step) => step.step === 'timecard-entries');
    const productivityStep = item.actuals.steps?.find((step) => step.step === 'productivity-logs');
    console.log(
      `${prefix} actuals status=${actualsResult.status} timecards=${timecardStep?.totalEntriesSaved ?? '?'} productivity=${productivityStep?.totalLogsSaved ?? '?'}`
    );

    results.push(item);
    await sleep(delayMs);
  }

  const out = {
    startedAt: runStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    baseUrl,
    companyId,
    startDate,
    endDate,
    projectCount: projects.length,
    results,
  };
  const summaryPath = resolve(root, '.tmp', `analytics-actuals-refresh-${Date.now()}.json`);
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(out, null, 2));
  console.log(`[refresh] complete summary=${summaryPath}`);
}

main()
  .catch((error) => {
    console.error(`[refresh] failed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
