import { prisma } from './prisma';
import { loadEstimatingCostCodeCatalog } from './estimatingCostCodeCrosswalk';
import { canonicalBidBoardId, selectEstimateProposal, selectClosestPopulatedEstimate } from './estimatingDashboardLogic';
import type { LaborRate } from './qboDirectCostLabor';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export async function loadQboDirectCostLaborRates(companyId: string, projectId: string) {
  const boardRows = await prisma.pmcBidBoardProject.findMany({ where: { companyId, procoreProjectId: projectId } });
  // Match estimating-dashboard identity handling: company-prefixed imports are
  // historical copies, not a second project. Prefer the current unprefixed row.
  const byId = new Map<string, typeof boardRows[number]>();
  for (const board of boardRows) {
    const id = canonicalBidBoardId(board.bidBoardId);
    if (!byId.has(id) || board.bidBoardId === id) byId.set(id, board);
  }
  const boards = [...byId.values()];
  const proposals = await prisma.procoreEstimateProposal.findMany({ where: { companyId, OR: [{ procoreProjectId: projectId }, { bidBoardProjectId: { in: boards.map(b => b.bidBoardId) } }] } });
  const boardIds = [...new Set([...boards.map(b => canonicalBidBoardId(b.bidBoardId)), ...proposals.map(p => canonicalBidBoardId(p.bidBoardProjectId))])];
  if (boardIds.length !== 1) return { rates: [] as LaborRate[], issue: 'Labor rates require one explicitly linked Procore bid-board project.', proposalId: null };
  const counts = await prisma.procoreEstimateLineItem.groupBy({ by: ['proposalId'], where: { companyId, bidBoardProjectId: boardIds[0] }, _count: true });
  const stats = record(record(boards[0]?.payload).stats), hasTotal = Object.hasOwn(stats, 'total'), total = Number(stats.total);
  const candidates = proposals.map(p => ({ ...p, normalizedLineCount: counts.find(c => c.proposalId === p.proposalId)?._count || 0, isPrimaryEstimate: hasTotal && record(p.payload).type === 'ESTIMATE' && Math.abs(Number(record(p.payload).total) - total) < 0.01 }));
  const selected = selectEstimateProposal(candidates, { requirePrimary: hasTotal }) || (hasTotal ? selectClosestPopulatedEstimate(candidates, total) : null);
  if (!selected || String(record(selected.payload).type).toUpperCase() !== 'ESTIMATE') return { rates: [] as LaborRate[], issue: 'A populated primary/base estimate is required for labor rates.', proposalId: null };
  const lines = await prisma.procoreEstimateLineItem.findMany({ where: { companyId, bidBoardProjectId: boardIds[0], proposalId: selected.proposalId } });
  const catalog = loadEstimatingCostCodeCatalog(), rates: LaborRate[] = [];
  for (const line of lines) {
    const item = record(record(line.payload).cost_item);
    if (item.type !== 'LABOR' || !['HOUR', 'HOURS', 'HR', 'HRS'].includes(String(item.unit).toUpperCase())) continue;
    // ID-based catalog crosswalk only. Never infer labor cost codes from names.
    const code = line.costCode || catalog.get(String(line.costItemId || item.id))?.costCode;
    if (!code) continue;
    const raw = item.unit_labor_cost;
    rates.push({ costCode: code.replace(/\.L$/i, ''), rate: raw !== null && raw !== undefined && Number.isFinite(Number(raw)) ? String(raw) : null, lineItemId: line.lineItemId, proposalId: selected.proposalId, bidBoardId: boardIds[0], updatedAt: line.syncedAt.toISOString() });
  }
  return { rates, issue: null, proposalId: selected.proposalId };
}
