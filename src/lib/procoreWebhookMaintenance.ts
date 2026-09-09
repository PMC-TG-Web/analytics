import { prisma } from "@/lib/prisma";
import { getClientCredentialsToken, getCurrentProcoreRequestMetrics } from "@/lib/procore";
import { ensureProjectWebhookHook } from "@/lib/procoreProjectWebhooks";
import { claimDueProject, deferProjectSync, finishProjectSync, parkProjectSync } from "@/lib/procoreSyncQueue";
import { procorePollingProjectClass } from "@/lib/procorePollingPolicy";
import { shouldParkProjectOnboarding } from "@/lib/projectOnboardingPolicy";

export const PROJECT_WEBHOOK_DATASET = "project_webhooks";

type MaintenanceResult = {
  success: boolean;
  dataset: string;
  skipped?: boolean;
  reason?: string;
  completed?: boolean;
  deferred?: boolean;
  rateLimitUntil?: string;
  projectId?: string;
  steps?: Array<Record<string, unknown>>;
};

/** Called inside the authenticated onboarding worker's existing company lease.
 * Separate queue state lets registration retry after onboarding itself succeeds.
 */
export async function maintainProjectWebhooks(params: { companyId: string; leaseId: string; projectId?: string }): Promise<MaintenanceResult> {
  const projects = await prisma.pmcProject.findMany({
    where: { companyId: params.companyId },
    select: { procoreProjectId: true, projectName: true, projectNumber: true, status: true, bidBoardStatus: true },
  });
  const eligible = projects.filter((project) => project.procoreProjectId
    && procorePollingProjectClass(project) !== "excluded"
    && !shouldParkProjectOnboarding({ ...project, projectId: project.procoreProjectId }));
  if (eligible.length) {
    await prisma.procoreSyncProjectState.createMany({
      data: eligible.map((project) => ({
        companyId: params.companyId,
        projectId: project.procoreProjectId,
        projectName: project.projectName,
        projectNumber: project.projectNumber,
        dataset: PROJECT_WEBHOOK_DATASET,
      })),
      skipDuplicates: true,
    });
    await prisma.procoreSyncProjectState.updateMany({
      where: { companyId: params.companyId, dataset: PROJECT_WEBHOOK_DATASET,
        projectId: { in: eligible.map((project) => project.procoreProjectId) },
        lastError: "Excluded from project webhook maintenance by current canonical project status." },
      data: { nextRunAt: new Date(), lastError: null },
    });
  }
  const project = await claimDueProject({ ...params, dataset: PROJECT_WEBHOOK_DATASET });
  if (!project) return { success: true, skipped: true, reason: "no_project_due", dataset: PROJECT_WEBHOOK_DATASET };
  if (!eligible.some((candidate) => candidate.procoreProjectId === project.projectId)) {
    await parkProjectSync({ project, reason: "Excluded from project webhook maintenance by current canonical project status." });
    return { success: true, skipped: true, reason: "project_excluded", dataset: PROJECT_WEBHOOK_DATASET };
  }

  const startedAt = Date.now();
  const selection = { step: "select-project", status: "ok", projectId: project.projectId, dataset: PROJECT_WEBHOOK_DATASET };
  const log = await prisma.syncLog.create({
    data: { companyId: params.companyId, triggeredBy: "project-webhook-maintenance", steps: [selection] },
    select: { id: true },
  });
  try {
    const detail = await ensureProjectWebhookHook({
      companyId: params.companyId,
      projectId: project.projectId,
      token: await getClientCredentialsToken(),
    });
    await finishProjectSync({ project, success: true, nextRunMinutes: 7 * 24 * 60, result: detail });
    const step = { step: "project-webhooks", status: "ok", httpStatus: 200, apiRequests: detail.apiRequests, detail };
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { success: true, finishedAt: new Date(), totalMs: Date.now() - startedAt, steps: [selection, step] },
    });
    return { success: true, completed: true, projectId: project.projectId, dataset: PROJECT_WEBHOOK_DATASET, steps: [step] };
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status || 0);
    const supplied = (error as { rateLimitUntil?: Date })?.rateLimitUntil;
    const until = status === 429 ? supplied || new Date(Date.now() + 15 * 60_000) : null;
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "Project webhook maintenance failed.";
    const apiRequests = getCurrentProcoreRequestMetrics().apiRequests;
    // Clear previous coverage on any failed verification. Actuals must return
    // to its conservative interval until this registration is verified again.
    const detail = { actualsCovered: false, apiRequests, error: message };
    if (until) await deferProjectSync({ project, until, result: detail });
    else await finishProjectSync({ project, success: false, nextRunMinutes: 30, error: message, result: detail });
    const step = { step: "project-webhooks", status: until ? "deferred" : "error", httpStatus: status || 500,
      rateLimited: Boolean(until), rateLimitUntil: until?.toISOString(), apiRequests, detail };
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { success: Boolean(until), finishedAt: new Date(), totalMs: Date.now() - startedAt, steps: [selection, step], error: until ? null : message },
    });
    return { success: Boolean(until), completed: false, deferred: Boolean(until), rateLimitUntil: until?.toISOString(),
      projectId: project.projectId, dataset: PROJECT_WEBHOOK_DATASET, steps: [step] };
  }
}
