import { prisma } from '@/lib/prisma';
import { loadEstimatingDashboardProjects } from '@/lib/estimatingDashboard';
import { loadFinancialWipSoldDates } from '@/lib/loadFinancialSoldDates';
import { calculateKpiActualSales } from '@/lib/kpiActualSales';

export async function loadKpiActualSales() {
  const companyId = process.env.PROCORE_COMPANY_ID?.trim();
  if (!companyId) throw new Error('The Procore company is not configured.');
  const [projects, dates, canonical] = await Promise.all([
    loadEstimatingDashboardProjects(),
    loadFinancialWipSoldDates(companyId),
    prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, bidBoardId: true } }),
  ]);
  return calculateKpiActualSales(projects, dates, canonical);
}
