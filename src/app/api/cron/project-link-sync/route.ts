import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import { getClientCredentialsToken, withProcoreLiveApiBypassForSyncSecret } from "@/lib/procore";
import {
  syncCommitmentMakerProjectLink,
  syncJobScheduleProjectLink,
} from "@/lib/procoreProjectLinkSync";
import {
  acquireProcoreWorker,
  claimDueProject,
  finishProjectSync,
  getSyncQueueStats,
  releaseProcoreWorker,
  seedPmcProjectSyncQueue,
  setProcoreRateLimit,
  type QueuedProject,
} from "@/lib/procoreSyncQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMPANY_ID = (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();
const DATASET = "project_home_links";

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

function errorStatus(error: unknown) {
  const status = Number((error as { status?: unknown })?.status || 0);
  if (status) return status;
  const match = (error instanceof Error ? error.message : String(error)).match(/(?:error|failed)\s+(\d{3})/i);
  return Number(match?.[1] || 0);
}

async function ensureExplicitProject(projectId: string) {
  await seedPmcProjectSyncQueue(COMPANY_ID, DATASET);
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_project_states (
        company_id, project_id, dataset, next_run_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NOW(), NOW(), NOW())
      ON CONFLICT (company_id, project_id, dataset)
      DO UPDATE SET next_run_at = LEAST(procore_sync_project_states.next_run_at, NOW()), updated_at = NOW()
    `,
    COMPANY_ID,
    projectId,
    DATASET,
  );
}

async function run(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const explicitProjectId = String(body.projectId || request.nextUrl.searchParams.get("projectId") || "").trim() || null;
  const worker = await acquireProcoreWorker(COMPANY_ID, 2);
  if (!worker.acquired) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: worker.reason,
      dataset: DATASET,
      rateLimitUntil: worker.control?.rate_limit_until || null,
      workerLockedUntil: worker.control?.worker_locked_until || null,
    });
  }

  let project: QueuedProject | null = null;
  const startedAt = Date.now();
  try {
    if (explicitProjectId) await ensureExplicitProject(explicitProjectId);
    else await seedPmcProjectSyncQueue(COMPANY_ID, DATASET);
    project = await claimDueProject({
      companyId: COMPANY_ID,
      dataset: DATASET,
      leaseId: worker.leaseId,
      leaseMinutes: 2,
      projectId: explicitProjectId || undefined,
    });
    if (!project) {
      return NextResponse.json({ success: true, skipped: true, reason: "no_project_due", dataset: DATASET });
    }

    try {
      const token = await getClientCredentialsToken();
      const errors: string[] = [];
      const result: Record<string, unknown> = {};
      try {
        result.jobSchedule = await syncJobScheduleProjectLink({
          token,
          companyId: COMPANY_ID,
          projectId: project.projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.jobSchedule = { status: "error", error: message };
        errors.push(`Job Schedule: ${message}`);
      }
      try {
        result.commitmentMaker = await syncCommitmentMakerProjectLink({
          token,
          companyId: COMPANY_ID,
          projectId: project.projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.commitmentMaker = { status: "error", error: message };
        errors.push(`Commitment Maker: ${message}`);
      }
      if (errors.length > 0) {
        throw new Error(errors.join(" | "));
      }
      const jobScheduleStatus = String(
        (result.jobSchedule as { status?: unknown } | undefined)?.status || "",
      );
      const waitingForTemplateDocuments = [
        "missing_folder",
        "missing_file",
        "missing_file_url",
      ].includes(jobScheduleStatus);
      await finishProjectSync({
        project,
        success: true,
        nextRunMinutes: waitingForTemplateDocuments ? 15 : 24 * 60,
        result,
      });
      const queue = await getSyncQueueStats(COMPANY_ID, DATASET);
      return NextResponse.json({
        success: true,
        companyId: COMPANY_ID,
        dataset: DATASET,
        projectId: project.projectId,
        projectNumber: project.projectNumber,
        projectName: project.projectName,
        result,
        queue,
        totalMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = errorStatus(error) === 429;
      if (rateLimited) {
        await setProcoreRateLimit({
          companyId: COMPANY_ID,
          until: new Date(Date.now() + 15 * 60_000),
          error: message.slice(0, 4_000),
        });
      }
      await finishProjectSync({
        project,
        success: false,
        nextRunMinutes: rateLimited ? 15 : 30,
        error: message.slice(0, 4_000),
      });
      return NextResponse.json({
        success: false,
        companyId: COMPANY_ID,
        dataset: DATASET,
        projectId: project.projectId,
        rateLimited,
        error: message,
        totalMs: Date.now() - startedAt,
      }, { status: rateLimited ? 429 : 502 });
    }
  } finally {
    if (project) {
      await prisma.$executeRawUnsafe(
        `
          UPDATE procore_sync_project_states
          SET locked_by = NULL, locked_until = NULL, updated_at = NOW()
          WHERE company_id = $1 AND project_id = $2 AND dataset = $3 AND locked_by = $4
        `,
        COMPANY_ID,
        project.projectId,
        DATASET,
        worker.leaseId,
      ).catch(() => undefined);
    }
    await releaseProcoreWorker(COMPANY_ID, worker.leaseId).catch(() => undefined);
  }
}

export async function POST(request: NextRequest) {
  return withProcoreLiveApiBypassForSyncSecret(request, () => run(request));
}
