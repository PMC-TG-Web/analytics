import { prisma } from '@/lib/prisma';
import { buildDashboardWinRateHistory } from '@/lib/dashboardWinRate';
import type { EstimatingDashboardProject } from '@/lib/estimatingDashboard';
import {
  KPI_CURRENT_COMPANY, KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY,
  parseWinRateBaseline, type WinRatePolicy,
} from '@/lib/kpiWinRate';

export async function loadDashboardWinRateHistory(projects: EstimatingDashboardProject[]) {
  if ((process.env.PROCORE_COMPANY_ID?.trim() || KPI_CURRENT_COMPANY) !== KPI_CURRENT_COMPANY) {
    throw new Error('Saved bid history is not configured for this company.');
  }
  const settings = await prisma.estimatingConstant.findMany({
    where: { name: { in: [KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY] } },
    select: { name: true, value: true },
  });
  const values = new Map(settings.map(setting => [setting.name, setting.value]));
  const saved = values.get(KPI_WIN_RATE_BASELINE_KEY);
  const grouping = values.get(KPI_WIN_RATE_POLICY_KEY);
  if (!saved || !grouping) throw new Error('Saved bid history and approved reporting groups are required.');
  const policy = JSON.parse(grouping) as WinRatePolicy;
  if (!Array.isArray(policy?.groups) || !Array.isArray(policy?.excludedSources)) {
    throw new Error('Invalid approved bid-history reporting groups.');
  }
  return buildDashboardWinRateHistory(projects, parseWinRateBaseline(saved), policy);
}
