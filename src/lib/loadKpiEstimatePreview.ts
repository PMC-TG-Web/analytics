import { prisma } from '@/lib/prisma';
import { loadEstimatingDashboardProjects } from '@/lib/estimatingDashboard';
import { calculateEstimatePreview } from '@/lib/kpiEstimatePreview';
import { KPI_CURRENT_COMPANY, KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY, parseWinRateBaseline, type WinRatePolicy } from '@/lib/kpiWinRate';
import { loadKpiLegacyEstimateLedger } from '@/lib/loadKpiLegacyEstimateLedger';
import { unmigratedLegacySnapshots } from '@/lib/kpiLegacyEstimateLedger';

export async function loadKpiEstimatePreview({ includeLegacy = true } = {}) {
  if (process.env.PROCORE_COMPANY_ID?.trim() !== KPI_CURRENT_COMPANY) throw new Error('Preview company mismatch.');
  const [values, bids, settings, baseline, proposals, lines, canonical, savedLegacy] = await Promise.all([
    loadEstimatingDashboardProjects(),
    prisma.pmcBidBoardProject.findMany({ where: { companyId: KPI_CURRENT_COMPANY }, select: { companyId: true, bidBoardId: true, procoreProjectId: true, projectName: true, status: true, payload: true } }),
    prisma.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_POLICY_KEY }, select: { value: true } }),
    prisma.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_BASELINE_KEY }, select: { value: true } }),
    prisma.procoreEstimateProposal.findMany({ where: { companyId: KPI_CURRENT_COMPANY }, select: { bidBoardProjectId: true, proposalId: true, proposalName: true, sourceUpdatedAt: true, payload: true } }),
    prisma.procoreEstimateLineItem.groupBy({ by: ['bidBoardProjectId', 'proposalId'], where: { companyId: KPI_CURRENT_COMPANY }, _sum: { laborHours: true }, _count: { _all: true } }),
    prisma.pmcProject.findMany({ where: { companyId: KPI_CURRENT_COMPANY }, select: { procoreProjectId: true, bidBoardId: true } }),
    includeLegacy ? loadKpiLegacyEstimateLedger() : Promise.resolve(null),
  ]);
  if (!settings || !baseline) throw new Error('Approved grouping and original Created Dates are required.');
  const lineTotals = new Map(lines.map(row => [`${row.bidBoardProjectId}:${row.proposalId}`, row]));
  const policy = JSON.parse(settings.value) as WinRatePolicy;
  const legacy = unmigratedLegacySnapshots(savedLegacy?.ledger.records.map(row => row.snapshot) ?? [], bids, policy);
  const report = calculateEstimatePreview(
    [...parseWinRateBaseline(baseline.value).bids, ...bids], values,
    proposals.map(row => {
      const payload = row.payload as Record<string, unknown>;
      const total = lineTotals.get(`${row.bidBoardProjectId}:${row.proposalId}`);
      const sales = payload.total == null || payload.total === '' ? null : Number(payload.total);
      return { bidBoardId: row.bidBoardProjectId, proposalId: row.proposalId, name: row.proposalName || row.proposalId,
        type: String(payload.type ?? ''), primary: payload.is_primary === true,
        order: payload.order != null && Number.isFinite(Number(payload.order)) ? Number(payload.order) : null,
        alternate: payload.is_procore_bid_form_alternate === true,
        updatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
        hours: total?._count._all ? Number(total._sum.laborHours ?? 0) : null,
        sales: sales !== null && Number.isFinite(sales) ? sales : null };
    }), policy, canonical, new Date(), legacy,
  );
  if (savedLegacy) report.legacyLedger = { source: savedLegacy.source, records: legacy.length,
    contributingProjects: report.projects.filter(project => project.legacySource).length,
    missingHours: report.projects.filter(project => project.legacySource && project.hours === null).length };
  return report;
}
