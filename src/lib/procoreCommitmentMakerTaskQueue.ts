import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type {
  CommitmentMakerChangeOrderContext,
  CommitmentMakerTaskKind,
} from "@/lib/procoreCommitmentMakerTasks";
import { runCommitmentMakerChangeOrderTasks } from "@/lib/procoreCommitmentMakerTaskRunner";

const DATASET_PREFIX = "commitment_maker_tasks:";

type TaskPayload = {
  changeOrder: CommitmentMakerChangeOrderContext;
  userEmail: string;
  commitmentChangeOrderId?: string;
  taskKinds?: CommitmentMakerTaskKind[];
};

export function commitmentMakerTaskDataset(
  sourceChangeOrderId: string,
  taskKinds?: CommitmentMakerTaskKind[],
) {
  const kindSuffix = taskKinds?.length === 1 ? `:${taskKinds[0]}` : "";
  return `${DATASET_PREFIX}${sourceChangeOrderId}${kindSuffix}`;
}

export function commitmentMakerTaskRetryDelayMinutes(failureCount: number) {
  return Math.min(60, 5 * 2 ** Math.min(Math.max(0, failureCount - 1), 4));
}

export async function enqueueCommitmentMakerTasks(params: {
  companyId: string;
  projectId: string;
  changeOrder: CommitmentMakerChangeOrderContext;
  userEmail: string;
  commitmentChangeOrderId?: string;
  taskKinds?: CommitmentMakerTaskKind[];
}) {
  const payload: TaskPayload = {
    changeOrder: params.changeOrder,
    userEmail: params.userEmail,
    commitmentChangeOrderId: params.commitmentChangeOrderId,
    taskKinds: params.taskKinds,
  };
  return prisma.procoreSyncProjectState.upsert({
    where: {
      companyId_projectId_dataset: {
        companyId: params.companyId,
        projectId: params.projectId,
        dataset: commitmentMakerTaskDataset(params.changeOrder.packageId, params.taskKinds),
      },
    },
    create: {
      companyId: params.companyId,
      projectId: params.projectId,
      dataset: commitmentMakerTaskDataset(params.changeOrder.packageId, params.taskKinds),
      nextRunAt: new Date(),
      lastResult: payload as unknown as Prisma.InputJsonValue,
    },
    update: {
      nextRunAt: new Date(),
      lockedUntil: null,
      lockedBy: null,
      lastError: null,
      lastResult: payload as unknown as Prisma.InputJsonValue,
    },
  });
}

function taskPayload(value: unknown): TaskPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const changeOrder = payload.changeOrder;
  if (!changeOrder || typeof changeOrder !== "object" || Array.isArray(changeOrder)) return null;
  const source = changeOrder as Record<string, unknown>;
  const packageId = String(source.packageId || "").trim();
  if (!packageId) return null;
  const taskKinds = Array.isArray(payload.taskKinds)
    ? payload.taskKinds.filter((kind): kind is CommitmentMakerTaskKind => (
      kind === "aia_billing" || kind === "commitment_verification"
    ))
    : undefined;
  return {
    changeOrder: {
      packageId,
      number: String(source.number || "").trim(),
      title: String(source.title || "").trim(),
      amount: source.amount === null ? null : Number(source.amount),
    },
    userEmail: String(payload.userEmail || "procore-project-link@pmcdecor.com").trim(),
    commitmentChangeOrderId: String(payload.commitmentChangeOrderId || "").trim() || undefined,
    taskKinds: taskKinds?.length ? taskKinds : undefined,
  };
}

export async function processNextCommitmentMakerTaskJob() {
  const now = new Date();
  const job = await prisma.procoreSyncProjectState.findFirst({
    where: {
      dataset: { startsWith: DATASET_PREFIX },
      nextRunAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
  });
  if (!job) return { success: true, skipped: true, reason: "no-due-task-job" };
  const workerId = `commitment-maker-tasks-${Date.now()}`;
  const claimed = await prisma.procoreSyncProjectState.updateMany({
    where: {
      id: job.id,
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: {
      lockedBy: workerId,
      lockedUntil: new Date(Date.now() + 10 * 60_000),
      lastAttemptAt: now,
    },
  });
  if (claimed.count !== 1) return { success: true, skipped: true, reason: "job-already-claimed" };
  const payload = taskPayload(job.lastResult);
  if (!payload) {
    await prisma.procoreSyncProjectState.update({
      where: { id: job.id },
      data: { lockedBy: null, lockedUntil: null, failureCount: { increment: 1 }, lastError: "Invalid task payload", nextRunAt: new Date(Date.now() + 60 * 60_000) },
    });
    return { success: false, projectId: job.projectId, error: "Invalid task payload" };
  }
  try {
    const result = await runCommitmentMakerChangeOrderTasks({
      companyId: job.companyId,
      projectId: job.projectId,
      changeOrder: payload.changeOrder,
      userEmail: payload.userEmail,
      taskKinds: payload.taskKinds,
    });
    await prisma.procoreSyncProjectState.update({
      where: { id: job.id },
      data: {
        lockedBy: null,
        lockedUntil: null,
        failureCount: 0,
        lastError: null,
        lastSuccessAt: new Date(),
        nextRunAt: new Date("9999-12-31T00:00:00.000Z"),
        lastResult: JSON.parse(JSON.stringify({ ...payload, taskResult: result })) as Prisma.InputJsonValue,
      },
    });
    return { success: true, projectId: job.projectId, sourceChangeOrderId: payload.changeOrder.packageId, taskResult: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failures = job.failureCount + 1;
    await prisma.procoreSyncProjectState.update({
      where: { id: job.id },
      data: {
        lockedBy: null,
        lockedUntil: null,
        failureCount: failures,
        lastError: message.slice(0, 4_000),
        nextRunAt: new Date(Date.now() + commitmentMakerTaskRetryDelayMinutes(failures) * 60_000),
      },
    });
    return { success: false, projectId: job.projectId, sourceChangeOrderId: payload.changeOrder.packageId, error: message };
  }
}
