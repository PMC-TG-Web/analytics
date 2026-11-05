import { loadProjectUsageData } from './loadProjectUsageReport';
import { buildHoursReport } from './hoursReport';

export async function loadHoursReport(companyId: string, from: string, through: string) {
  const { period, projects, records } = await loadProjectUsageData(companyId, from, through);
  return buildHoursReport(companyId, period, projects, records);
}
