import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { CommitmentMakerChangeOrderSourceAlias } from "@/lib/procore/commitmentMakerChangeOrders";

const CLAIM_LEASE_MS = 5 * 60 * 1_000;

type TargetKind = "new_purchase_order" | "existing_purchase_order";

type ClaimParams = {
  companyId: string;
  projectId: string;
  sourceKind: CommitmentMakerChangeOrderSourceAlias["sourceKind"];
  sourceId: string;
  sourceNumber: string;
  sourceTitle: string;
  aliases: CommitmentMakerChangeOrderSourceAlias[];
  targetKind: TargetKind;
  requestedTargetCommitmentId: string;
  requestFingerprint: string;
};

type ApplicationRecord = Awaited<ReturnType<typeof findApplicationForAliases>>;

type ExistingClaim = {
  targetKind: string;
  requestedTargetCommitmentId: string | null;
  targetCommitmentId: string | null;
  status: string;
  leaseExpiresAt: Date;
};

type HistoricalApplication = {
  targetCommitmentId: string;
};

export class CommitmentMakerChangeOrderClaimError extends Error {
  readonly status: 409;

  constructor(message: string) {
    super(message);
    this.name = "CommitmentMakerChangeOrderClaimError";
    this.status = 409;
  }
}

function aliasWhere(params: Pick<ClaimParams, "companyId" | "projectId" | "aliases">) {
  return params.aliases.map((alias) => ({
    companyId: params.companyId,
    projectId: params.projectId,
    sourceKind: alias.sourceKind,
    sourceId: alias.sourceId,
  }));
}

async function findApplicationForAliases(
  client: Prisma.TransactionClient | typeof prisma,
  params: Pick<ClaimParams, "companyId" | "projectId" | "aliases">,
) {
  const where = aliasWhere(params);
  if (where.length === 0) return null;
  const aliases = await client.commitmentMakerChangeOrderAlias.findMany({
    where: { OR: where },
    include: { application: true },
  });
  const applicationIds = [...new Set(aliases.map((alias) => alias.applicationId))];
  if (applicationIds.length > 1) {
    throw new CommitmentMakerChangeOrderClaimError(
      "This change order has conflicting prior Commitment Maker records and cannot be added automatically.",
    );
  }
  return aliases[0]?.application || null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function findHistoricalApplication(
  client: Prisma.TransactionClient | typeof prisma,
  params: Pick<ClaimParams, "projectId" | "aliases">,
): Promise<HistoricalApplication | null> {
  const aliasKeys = new Set(params.aliases.map((alias) => `${alias.sourceKind}:${alias.sourceId}`));
  const audits = await client.auditLog.findMany({
    where: {
      entity: "ProcoreCommitmentMaker",
      action: { in: ["create", "resume", "append-lines"] },
      changes: { path: ["projectId"], equals: params.projectId },
    },
    orderBy: { createdAt: "asc" },
    select: { entityId: true, changes: true },
  });
  for (const audit of audits) {
    const changes = record(audit.changes);
    const source = record(changes.sourceChangeOrder);
    const key = `${String(source.sourceKind || "")}:${String(source.packageId || "")}`;
    if (aliasKeys.has(key) && audit.entityId) return { targetCommitmentId: audit.entityId };
  }
  return null;
}

function historicalBlockReason(
  historical: HistoricalApplication,
  params: Pick<ClaimParams, "targetKind" | "requestedTargetCommitmentId">,
): string {
  if (
    params.targetKind === "existing_purchase_order"
    && params.requestedTargetCommitmentId
    && params.requestedTargetCommitmentId !== historical.targetCommitmentId
  ) {
    return `This change order is already assigned to PO ${historical.targetCommitmentId} and cannot be added to a different PO.`;
  }
  return `This change order was already added to PO ${historical.targetCommitmentId}.`;
}

function targetLabel(application: ExistingClaim): string {
  return application.targetCommitmentId || application.requestedTargetCommitmentId || "another purchase order";
}

export function commitmentMakerClaimCanReconcileByTitle(application: ExistingClaim, now = new Date()): boolean {
  return application.status === "claimed"
    && application.leaseExpiresAt <= now
    && !application.targetCommitmentId;
}

export function commitmentMakerChangeOrderClaimBlockReason(
  application: ExistingClaim,
  params: Pick<ClaimParams, "targetKind" | "requestedTargetCommitmentId">,
  now = new Date(),
): string | null {
  if (application.status === "removed") return null;
  const sameTargetKind = application.targetKind === params.targetKind;
  const sameExistingTarget = params.targetKind !== "existing_purchase_order"
    || application.requestedTargetCommitmentId === (params.requestedTargetCommitmentId || null);
  if (!sameTargetKind || !sameExistingTarget) {
    return `This change order is already assigned to PO ${targetLabel(application)} and cannot be added to a different PO.`;
  }
  if (application.status === "completed") {
    return `This change order was already added to PO ${targetLabel(application)}.`;
  }
  if (application.status === "removing") {
    return `This change order is being removed from PO ${targetLabel(application)}.`;
  }
  if (application.status === "claimed" && application.leaseExpiresAt > now) {
    return "This change order is already being added to a purchase order.";
  }
  return null;
}

function assertClaimAvailable(application: NonNullable<ApplicationRecord>, params: ClaimParams, now: Date): void {
  const blockReason = commitmentMakerChangeOrderClaimBlockReason(application, params, now);
  if (blockReason) throw new CommitmentMakerChangeOrderClaimError(blockReason);
}

export async function inspectCommitmentMakerChangeOrderClaim(params: Pick<ClaimParams,
  "companyId" | "projectId" | "aliases" | "targetKind" | "requestedTargetCommitmentId"
>): Promise<string | null> {
  const application = await findApplicationForAliases(prisma, params);
  if (!application) {
    const historical = await findHistoricalApplication(prisma, params);
    return historical ? historicalBlockReason(historical, params) : null;
  }
  return commitmentMakerChangeOrderClaimBlockReason(application, params);
}

export async function claimCommitmentMakerChangeOrder(params: ClaimParams) {
  const leaseToken = randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);

  const claim = async () => prisma.$transaction(async (transaction) => {
    const existing = await findApplicationForAliases(transaction, params);
    if (existing) {
      assertClaimAvailable(existing, params, now);
      const reconcileUnconfirmedCreate = commitmentMakerClaimCanReconcileByTitle(existing, now);
      const renewed = await transaction.commitmentMakerChangeOrderApplication.updateMany({
        where: {
          id: existing.id,
          status: { not: "completed" },
          OR: [
            { status: "failed" },
            { leaseExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: "claimed",
          leaseToken,
          leaseExpiresAt,
          targetKind: params.targetKind,
          requestedTargetCommitmentId: params.requestedTargetCommitmentId || null,
          targetCommitmentId: null,
          requestFingerprint: params.requestFingerprint,
          lastError: null,
        },
      });
      if (renewed.count !== 1) {
        throw new CommitmentMakerChangeOrderClaimError(
          "This change order is already being added to a purchase order.",
        );
      }
      const existingKeys = new Set((await transaction.commitmentMakerChangeOrderAlias.findMany({
        where: { applicationId: existing.id },
        select: { sourceKind: true, sourceId: true },
      })).map((alias) => `${alias.sourceKind}:${alias.sourceId}`));
      const missingAliases = params.aliases.filter((alias) => !existingKeys.has(`${alias.sourceKind}:${alias.sourceId}`));
      if (missingAliases.length > 0) {
        await transaction.commitmentMakerChangeOrderAlias.createMany({
          data: missingAliases.map((alias) => ({
            companyId: params.companyId,
            projectId: params.projectId,
            sourceKind: alias.sourceKind,
            sourceId: alias.sourceId,
            applicationId: existing.id,
          })),
        });
      }
      return {
        applicationId: existing.id,
        leaseToken,
        targetCommitmentId: existing.targetCommitmentId || "",
        reconcileUnconfirmedCreate,
      };
    }

    const historical = await findHistoricalApplication(transaction, params);
    if (historical) {
      throw new CommitmentMakerChangeOrderClaimError(historicalBlockReason(historical, params));
    }

    const created = await transaction.commitmentMakerChangeOrderApplication.create({
      data: {
        companyId: params.companyId,
        projectId: params.projectId,
        sourceKind: params.sourceKind,
        sourceId: params.sourceId,
        sourceNumber: params.sourceNumber || null,
        sourceTitle: params.sourceTitle || null,
        targetKind: params.targetKind,
        requestedTargetCommitmentId: params.requestedTargetCommitmentId || null,
        requestFingerprint: params.requestFingerprint,
        status: "claimed",
        leaseToken,
        leaseExpiresAt,
        aliases: {
          create: params.aliases.map((alias) => ({
            companyId: params.companyId,
            projectId: params.projectId,
            sourceKind: alias.sourceKind,
            sourceId: alias.sourceId,
          })),
        },
      },
    });
    return { applicationId: created.id, leaseToken, targetCommitmentId: "", reconcileUnconfirmedCreate: false };
  });

  try {
    return await claim();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CommitmentMakerChangeOrderClaimError(
        "This change order was claimed by another Commitment Maker request. Preview again to see its current PO.",
      );
    }
    throw error;
  }
}

export async function setCommitmentMakerChangeOrderTarget(params: {
  applicationId: string;
  leaseToken: string;
  targetCommitmentId: string;
}): Promise<void> {
  const updated = await prisma.commitmentMakerChangeOrderApplication.updateMany({
    where: {
      id: params.applicationId,
      leaseToken: params.leaseToken,
      status: "claimed",
      OR: [
        { targetCommitmentId: null },
        { targetCommitmentId: params.targetCommitmentId },
      ],
    },
    data: { targetCommitmentId: params.targetCommitmentId },
  });
  if (updated.count !== 1) throw new Error("The Commitment Maker change-order claim lease was lost.");
}

export async function completeCommitmentMakerChangeOrderClaim(params: {
  applicationId: string;
  leaseToken: string;
  targetCommitmentId: string;
}): Promise<void> {
  const updated = await prisma.commitmentMakerChangeOrderApplication.updateMany({
    where: {
      id: params.applicationId,
      leaseToken: params.leaseToken,
      status: "claimed",
      OR: [
        { targetCommitmentId: null },
        { targetCommitmentId: params.targetCommitmentId },
      ],
    },
    data: {
      status: "completed",
      targetCommitmentId: params.targetCommitmentId,
      completedAt: new Date(),
      lastError: null,
    },
  });
  if (updated.count !== 1) throw new Error("The Commitment Maker change-order claim could not be completed.");
}

export async function failCommitmentMakerChangeOrderClaim(params: {
  applicationId: string;
  leaseToken: string;
  targetCommitmentId?: string;
  error: string;
}): Promise<void> {
  await prisma.commitmentMakerChangeOrderApplication.updateMany({
    where: { id: params.applicationId, leaseToken: params.leaseToken, status: "claimed" },
    data: {
      status: "failed",
      targetCommitmentId: params.targetCommitmentId || undefined,
      leaseExpiresAt: new Date(),
      lastError: params.error.substring(0, 4_000),
    },
  });
}

export async function getCommitmentMakerChangeOrderRemovalTarget(params: Pick<ClaimParams,
  "companyId" | "projectId" | "aliases"
>): Promise<{
  applicationId: string;
  targetCommitmentId: string;
  status: "completed" | "removing";
  lastError: string | null;
} | null> {
  const application = await findApplicationForAliases(prisma, params);
  if (
    !application
    || !["completed", "removing"].includes(application.status)
    || !application.targetCommitmentId
  ) return null;
  return {
    applicationId: application.id,
    targetCommitmentId: application.targetCommitmentId,
    status: application.status as "completed" | "removing",
    lastError: application.lastError,
  };
}

export async function claimCommitmentMakerChangeOrderRemovalRecovery(params: Pick<ClaimParams,
  "companyId" | "projectId" | "aliases"
>) {
  const leaseToken = randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
  return prisma.$transaction(async (transaction) => {
    const application = await findApplicationForAliases(transaction, params);
    if (!application?.targetCommitmentId || application.status !== "removing") {
      throw new CommitmentMakerChangeOrderClaimError("This change order does not have an uncertain PO removal to repair.");
    }
    const updated = await transaction.commitmentMakerChangeOrderApplication.updateMany({
      where: {
        id: application.id,
        status: "removing",
        targetCommitmentId: application.targetCommitmentId,
        leaseExpiresAt: { lte: now },
      },
      data: { leaseToken, leaseExpiresAt },
    });
    if (updated.count !== 1) {
      throw new CommitmentMakerChangeOrderClaimError("This PO recovery is already running. Refresh and try again shortly.");
    }
    return {
      applicationId: application.id,
      leaseToken,
      targetCommitmentId: application.targetCommitmentId,
    };
  });
}

export async function claimCommitmentMakerChangeOrderRemoval(params: Pick<ClaimParams,
  "companyId" | "projectId" | "aliases"
>) {
  const leaseToken = randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS);
  return prisma.$transaction(async (transaction) => {
    const application = await findApplicationForAliases(transaction, params);
    if (!application?.targetCommitmentId) {
      throw new CommitmentMakerChangeOrderClaimError("This change order does not have a removable PO assignment.");
    }
    const updated = await transaction.commitmentMakerChangeOrderApplication.updateMany({
      where: {
        id: application.id,
        status: "completed",
        targetCommitmentId: application.targetCommitmentId,
      },
      data: {
        status: "removing",
        leaseToken,
        leaseExpiresAt,
        lastError: null,
      },
    });
    if (updated.count !== 1) {
      throw new CommitmentMakerChangeOrderClaimError("This change order is already being changed. Refresh and try again.");
    }
    return {
      applicationId: application.id,
      leaseToken,
      targetCommitmentId: application.targetCommitmentId,
    };
  });
}

export async function completeCommitmentMakerChangeOrderRemoval(params: {
  applicationId: string;
  leaseToken: string;
  targetCommitmentId: string;
}): Promise<void> {
  const updated = await prisma.commitmentMakerChangeOrderApplication.updateMany({
    where: {
      id: params.applicationId,
      leaseToken: params.leaseToken,
      status: "removing",
      targetCommitmentId: params.targetCommitmentId,
    },
    data: {
      status: "removed",
      requestedTargetCommitmentId: null,
      targetCommitmentId: null,
      leaseExpiresAt: new Date(),
      lastError: null,
    },
  });
  if (updated.count !== 1) throw new Error("The Commitment Maker removal claim could not be completed.");
}

export async function failCommitmentMakerChangeOrderRemoval(params: {
  applicationId: string;
  leaseToken: string;
  targetCommitmentId: string;
  error: string;
}): Promise<void> {
  const updated = await prisma.commitmentMakerChangeOrderApplication.updateMany({
    where: {
      id: params.applicationId,
      leaseToken: params.leaseToken,
      status: "removing",
      targetCommitmentId: params.targetCommitmentId,
    },
    data: {
      status: "completed",
      leaseExpiresAt: new Date(),
      lastError: params.error.substring(0, 4_000),
    },
  });
  if (updated.count !== 1) throw new Error("The Commitment Maker removal claim could not be restored.");
}

export async function completeCommitmentMakerChangeOrderRemovalRecovery(params: {
  applicationId: string;
  leaseToken: string;
  targetCommitmentId: string;
}): Promise<void> {
  const updated = await prisma.commitmentMakerChangeOrderApplication.updateMany({
    where: {
      id: params.applicationId,
      leaseToken: params.leaseToken,
      status: "removing",
      targetCommitmentId: params.targetCommitmentId,
    },
    data: {
      status: "completed",
      leaseExpiresAt: new Date(),
      lastError: null,
    },
  });
  if (updated.count !== 1) throw new Error("The Commitment Maker removal recovery could not be completed.");
}

export async function markCommitmentMakerChangeOrderRemovalUncertain(params: {
  applicationId: string;
  leaseToken: string;
  targetCommitmentId: string;
  error: string;
}): Promise<void> {
  const updated = await prisma.commitmentMakerChangeOrderApplication.updateMany({
    where: {
      id: params.applicationId,
      leaseToken: params.leaseToken,
      status: "removing",
      targetCommitmentId: params.targetCommitmentId,
    },
    data: {
      leaseExpiresAt: new Date(),
      lastError: params.error.substring(0, 4_000),
    },
  });
  if (updated.count !== 1) throw new Error("The uncertain Commitment Maker removal could not be recorded.");
}
