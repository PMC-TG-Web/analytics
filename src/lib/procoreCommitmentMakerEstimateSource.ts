import { prisma } from '@/lib/prisma';
import { commitmentMakerProcoreJson } from '@/lib/procoreCommitmentMakerClient';
import {
  estimateRecord, PrimaryEstimateError, selectCommitmentEstimateBoard, selectPrimaryCommitmentEstimate,
} from '@/lib/procore/commitmentMakerEstimate';

type RecordValue = Record<string, unknown>;
export type PrimaryEstimateSnapshot = {
  bidBoardProjectId: string; proposal: RecordValue; lines: RecordValue[]; groups: RecordValue[]; fetchedAt: string;
};

export async function commitmentEstimateIdentity(companyId: string, projectId: string) {
  const [project, boards, proposals] = await Promise.all([
    prisma.pmcProject.findUnique({ where: { companyId_procoreProjectId: { companyId, procoreProjectId: projectId } }, select: { bidBoardId: true } }),
    prisma.pmcBidBoardProject.findMany({ where: { companyId, procoreProjectId: projectId }, select: { bidBoardId: true } }),
    prisma.procoreEstimateProposal.findMany({ where: { companyId, procoreProjectId: projectId }, select: { bidBoardProjectId: true } }),
  ]);
  if (!project) throw new PrimaryEstimateError('This Procore project was not found in Analytics.');
  // Exact external IDs only. No fallback by project name, number or customer.
  return selectCommitmentEstimateBoard([project.bidBoardId, ...boards.map(row => row.bidBoardId), ...proposals.map(row => row.bidBoardProjectId)]);
}

export async function primaryCommitmentEstimateSummary(companyId: string, projectId: string) {
  try {
    const boardId = await commitmentEstimateIdentity(companyId, projectId);
    const proposals = await prisma.procoreEstimateProposal.findMany({ where: { companyId, bidBoardProjectId: boardId }, select: { payload: true, syncedAt: true } });
    const primary = selectPrimaryCommitmentEstimate(proposals.map(row => estimateRecord(row.payload)));
    return { proposalId: String(primary.id), name: String(primary.name || 'Primary Estimate'),
      syncedAt: proposals.find(row => String(estimateRecord(row.payload).id) === String(primary.id))?.syncedAt.toISOString() || '', error: '' };
  } catch (error) {
    if (!(error instanceof PrimaryEstimateError)) throw error;
    return { proposalId: '', name: '', syncedAt: '', error: error.message };
  }
}

/** A cached complete read can serve previews; creation always reads Procore again. */
export async function readPrimaryCommitmentEstimate(options: {
  companyId: string; projectId: string; forceLive: boolean; getToken: () => Promise<string>;
}) {
  const { companyId, projectId } = options;
  const bidBoardProjectId = await commitmentEstimateIdentity(companyId, projectId);
  if (!options.forceLive) {
    const [row] = await prisma.$queryRaw<Array<{ snapshot: PrimaryEstimateSnapshot; fetched_at: Date }>>`
      SELECT snapshot, fetched_at FROM procore_commitment_estimate_caches
      WHERE company_id = ${companyId} AND project_id = ${projectId}`;
    const age = Date.now() - (row?.fetched_at.getTime() || 0);
    if (row && age >= 0 && age < 5 * 60_000 && row.snapshot.bidBoardProjectId === bidBoardProjectId) return row.snapshot;
  }
  const token = await options.getToken();
  const base = `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(bidBoardProjectId)}`;
  async function pages(path: string, keys: string[], maxPages: number): Promise<RecordValue[]> {
    const rows: RecordValue[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await commitmentMakerProcoreJson({ companyId, accessToken: token, path: `${path}?page=${page}&per_page=100` });
      if (!response.ok) throw new PrimaryEstimateError(`The primary estimate could not be read from Procore (${response.status}).`);
      const root = estimateRecord(response.payload);
      const batch = Array.isArray(response.payload) ? response.payload : keys.map(key => root[key]).find(Array.isArray);
      if (!Array.isArray(batch)) throw new PrimaryEstimateError('Procore returned an incomplete estimate response. Refresh and try again.');
      for (const value of batch) {
        const record = estimateRecord(value);
        const id = String(record.id || '');
        if (!id || seen.has(id)) throw new PrimaryEstimateError('Procore returned incomplete or repeated estimate records. Refresh and try again.');
        seen.add(id);
        rows.push(record);
      }
      if (batch.length < 100) return rows;
    }
    throw new PrimaryEstimateError('The primary estimate exceeds the supported import size.');
  }
  const proposals = await pages(`${base}/proposals`, ['data', 'proposals'], 10);
  const proposal = selectPrimaryCommitmentEstimate(proposals);
  const detail = `${base}/proposals/${encodeURIComponent(String(proposal.id))}`;
  const groups = await pages(`${detail}/line_item_groups`, ['data', 'line_item_groups', 'groups'], 2);
  const lines = await pages(`${detail}/line_items`, ['data', 'line_items', 'items'], 51);
  const confirmed = selectPrimaryCommitmentEstimate(await pages(`${base}/proposals`, ['data', 'proposals'], 10));
  if (String(confirmed.id) !== String(proposal.id) || confirmed.updated_at !== proposal.updated_at) {
    throw new PrimaryEstimateError('The primary estimate changed while it was loading. Refresh and preview again.');
  }
  const snapshot: PrimaryEstimateSnapshot = { bidBoardProjectId, proposal, groups, lines, fetchedAt: new Date().toISOString() };
  // Write only a complete response. Never substitute an old snapshot after a failed live read.
  await prisma.$executeRaw`INSERT INTO procore_commitment_estimate_caches (company_id, project_id, snapshot, fetched_at)
    VALUES (${companyId}, ${projectId}, ${JSON.stringify(snapshot)}::jsonb, NOW())
    ON CONFLICT (company_id, project_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, fetched_at = EXCLUDED.fetched_at`
    .catch(() => console.warn('Primary estimate cache could not be updated.'));
  return snapshot;
}
