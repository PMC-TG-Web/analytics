import { prisma } from "./prisma";

/** Enrich an exact Bid Board identity without moving an established project link. */
export async function preserveBidBoardProjectLink(params: {
  companyId: string;
  bidBoardId: string;
  procoreProjectId: string | null | undefined;
}): Promise<{ procoreProjectId: string | null; conflict: boolean }> {
  if (!params.procoreProjectId) {
    const saved = await prisma.pmcBidBoardProject.findUnique({
      where: { companyId_bidBoardId: { companyId: params.companyId, bidBoardId: params.bidBoardId } },
      select: { procoreProjectId: true },
    });
    return { procoreProjectId: saved?.procoreProjectId || null, conflict: false };
  }
  const result = await prisma.pmcBidBoardProject.updateMany({
    where: {
      companyId: params.companyId,
      bidBoardId: params.bidBoardId,
      OR: [{ procoreProjectId: null }, { procoreProjectId: params.procoreProjectId }],
    },
    data: { procoreProjectId: params.procoreProjectId },
  });
  if (result.count === 1) return { procoreProjectId: params.procoreProjectId, conflict: false };
  console.warn("[procore-sync] established Bid Board project link preserved", {
    companyId: params.companyId, bidBoardId: params.bidBoardId,
  });
  return { procoreProjectId: null, conflict: true };
}

/** Several historical bids can share a project; they cannot replace its selected bid. */
export async function canUpdateProjectFromBidBoard(params: {
  companyId: string;
  procoreProjectId: string;
  bidBoardId: string;
}): Promise<boolean> {
  const existing = await prisma.pmcProject.findUnique({
    where: { companyId_procoreProjectId: { companyId: params.companyId, procoreProjectId: params.procoreProjectId } },
    select: { bidBoardId: true },
  });
  if (existing?.bidBoardId) return existing.bidBoardId === params.bidBoardId;
  const candidates = await prisma.pmcBidBoardProject.findMany({
    where: { companyId: params.companyId, procoreProjectId: params.procoreProjectId },
    select: { bidBoardId: true },
    take: 2,
  });
  return candidates.length === 1 && candidates[0].bidBoardId === params.bidBoardId;
}

export async function updateProjectBidBoardStatus(params: {
  companyId: string;
  procoreProjectId: string;
  bidBoardId: string;
  status: string;
}): Promise<boolean> {
  if (!await canUpdateProjectFromBidBoard(params)) {
    console.warn("[procore-sync] ambiguous project Bid Board selection preserved", {
      companyId: params.companyId, procoreProjectId: params.procoreProjectId, bidBoardId: params.bidBoardId,
    });
    return true;
  }
  const updated = await prisma.pmcProject.updateMany({
    where: {
      companyId: params.companyId,
      procoreProjectId: params.procoreProjectId,
      OR: [{ bidBoardId: null }, { bidBoardId: params.bidBoardId }],
    },
    data: { bidBoardId: params.bidBoardId, bidBoardStatus: params.status, syncedAt: new Date() },
  });
  if (updated.count === 1) return false;
  const existing = await prisma.pmcProject.findUnique({
    where: { companyId_procoreProjectId: { companyId: params.companyId, procoreProjectId: params.procoreProjectId } },
    select: { bidBoardId: true },
  });
  const conflict = Boolean(existing?.bidBoardId && existing.bidBoardId !== params.bidBoardId);
  if (conflict) {
    console.warn("[procore-sync] established project Bid Board link preserved", {
      companyId: params.companyId, procoreProjectId: params.procoreProjectId, bidBoardId: params.bidBoardId,
    });
  }
  return conflict;
}
