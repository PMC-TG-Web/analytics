import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const prisma = new PrismaClient();
const COMPANY_ID = process.env.PROCORE_COMPANY_ID || "598134325805519";
const BASE_URL = (process.env.ACTUALS_SYNC_BASE_URL || "https://analyticspmc.netlify.app").replace(/\/$/, "");
const SYNC_SECRET = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || "";
const START_DATE = process.env.ACTUALS_SYNC_START_DATE || "2025-08-01";
const END_DATE = process.env.ACTUALS_SYNC_END_DATE || new Date().toISOString().slice(0, 10);
const PROJECT_DELAY_MS = Math.max(0, Number(process.env.ACTUALS_SYNC_PROJECT_DELAY_MS || 10_000));
const STAGE_DELAY_MS = Math.max(0, Number(process.env.ACTUALS_SYNC_STAGE_DELAY_MS || 5_000));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.ACTUALS_SYNC_MAX_ATTEMPTS || 6));

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.join("=") || "true"];
  }),
);

const requestedProjectIds = String(args.get("projects") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const skippedProjectIds = new Set(
  String(args.get("skip") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const stages = [
  { step: "purchase-order-line-item-details", path: "/api/procore/sync/purchase-order-line-item-details" },
  { step: "timecard-entries", path: "/api/procore/sync/timecard-entries" },
  { step: "productivity-logs", path: "/api/procore/sync/productivity-projects" },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function output(event, detail = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...detail })}\n`);
}

function responseSummary(body) {
  if (!body || typeof body !== "object") return body;
  return {
    success: body.success,
    totalProjectsChecked: body.totalProjectsChecked,
    projectsWithActivity: body.projectsWithActivity,
    projectsWithPurchaseOrderContracts: body.projectsWithPurchaseOrderContracts,
    totalEntriesFetched: body.totalEntriesFetched,
    totalEntriesSaved: body.totalEntriesSaved,
    totalLogsFetched: body.totalLogsFetched,
    totalLogsSaved: body.totalLogsSaved,
    totalPurchaseOrderContractsFetched: body.totalPurchaseOrderContractsFetched,
    totalLineItemContractDetailsFetched: body.totalLineItemContractDetailsFetched,
    totalLineItemContractDetailsSaved: body.totalLineItemContractDetailsSaved,
    errors: Array.isArray(body.errors) ? body.errors.slice(0, 10) : undefined,
    error: body.error,
    details: body.details,
  };
}

async function postStage(path, payload) {
  let lastResult = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sync-secret": SYNC_SECRET,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8 * 60 * 1000),
      });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { raw: text.slice(0, 2_000) };
      }

      lastResult = {
        ok: response.ok,
        status: response.status,
        attempt,
        detail: responseSummary(body),
      };
      if (response.ok) return lastResult;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) return lastResult;
      const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
      const backoffMs = retryAfterSeconds > 0
        ? retryAfterSeconds * 1_000 + 2_000
        : Math.min(120_000, 10_000 * (2 ** (attempt - 1)));
      output("stage-retry", { path, status: response.status, attempt, waitMs: backoffMs });
      await wait(backoffMs);
    } catch (error) {
      lastResult = {
        ok: false,
        status: 0,
        attempt,
        detail: error instanceof Error ? error.message : String(error),
      };
      if (attempt === MAX_ATTEMPTS) return lastResult;
      const backoffMs = Math.min(120_000, 10_000 * (2 ** (attempt - 1)));
      output("stage-retry", { path, status: 0, attempt, waitMs: backoffMs });
      await wait(backoffMs);
    }
  }

  return lastResult;
}

async function projectQueue() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT
      b.project_id,
      COALESCE(p.project_number, '') AS project_number,
      COALESCE(p.project_name, b.project_id) AS project_name
    FROM budgetlineitems b
    LEFT JOIN pmc_projects p
      ON p.company_id = b.company_id
     AND p.procore_project_id = b.project_id
    WHERE b.company_id = $1
      AND b.project_id IS NOT NULL
      AND b.project_id <> ''
    ORDER BY COALESCE(p.project_number, ''), b.project_id
  `, COMPANY_ID);

  const requested = new Set(requestedProjectIds);
  return rows.filter((row) => {
    if (requested.size > 0 && !requested.has(row.project_id)) return false;
    return !skippedProjectIds.has(row.project_id);
  });
}

async function main() {
  if (!SYNC_SECRET) throw new Error("PROCORE_SYNC_SECRET or SYNC_SECRET is required");
  const queue = await projectQueue();
  output("run-start", {
    companyId: COMPANY_ID,
    baseUrl: BASE_URL,
    startDate: START_DATE,
    endDate: END_DATE,
    projectCount: queue.length,
  });

  for (let index = 0; index < queue.length; index += 1) {
    const project = queue[index];
    const startedAt = Date.now();
    const stepResults = [];
    const selectionStep = {
      step: "select-project",
      status: "ok",
      projectId: project.project_id,
      projectNumber: project.project_number,
      projectName: project.project_name,
      queuePosition: index + 1,
      queueCount: queue.length,
    };
    const log = await prisma.syncLog.create({
      data: {
        companyId: COMPANY_ID,
        triggeredBy: "actuals-project-runner",
        steps: [selectionStep],
      },
      select: { id: true },
    });

    output("project-start", {
      projectId: project.project_id,
      projectNumber: project.project_number,
      projectName: project.project_name,
      position: index + 1,
      total: queue.length,
      logId: log.id.toString(),
    });

    for (const stage of stages) {
      const result = await postStage(stage.path, {
        companyId: COMPANY_ID,
        projectIds: [project.project_id],
        startDate: START_DATE,
        endDate: END_DATE,
        perPage: 100,
        concurrency: 1,
        forceUserOAuth: false,
        persist: true,
      });
      const stepResult = {
        step: stage.step,
        status: result?.ok ? "ok" : "error",
        httpStatus: result?.status ?? 0,
        attempt: result?.attempt ?? 0,
        detail: result?.detail ?? null,
      };
      stepResults.push(stepResult);
      output("stage-finish", { projectId: project.project_id, ...stepResult });
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { steps: [selectionStep, ...stepResults] },
      });
      if (!result?.ok) break;
      if (STAGE_DELAY_MS > 0) await wait(STAGE_DELAY_MS);
    }

    const success = stepResults.length === stages.length && stepResults.every((step) => step.status === "ok");
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        success,
        totalMs: Date.now() - startedAt,
        steps: [selectionStep, ...stepResults],
        error: success ? null : "One or more project actuals stages failed",
      },
    });
    output("project-finish", {
      projectId: project.project_id,
      success,
      totalMs: Date.now() - startedAt,
    });

    if (PROJECT_DELAY_MS > 0 && index < queue.length - 1) await wait(PROJECT_DELAY_MS);
  }

  output("run-finish", { projectCount: queue.length });
}

main()
  .catch((error) => {
    output("run-error", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
