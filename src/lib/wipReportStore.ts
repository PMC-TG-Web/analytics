import { prisma } from '@/lib/prisma';
import { wipReportKey, supplementalWipProjects, type WipReportSnapshot } from '@/lib/wipReportImport';

export async function loadWipReportProjects(companyId: string, occupiedProjectIds: string[] = []) {
  const row = await prisma.estimatingConstant.findUnique({ where: { name: wipReportKey(companyId) } });
  if (!row) return [];
  const snapshot = JSON.parse(row.value) as WipReportSnapshot;
  if (row.category !== 'WIP_REPORTING' || snapshot.version !== 1 || snapshot.companyId !== companyId || !Array.isArray(snapshot.projects)) throw new Error('Invalid WIP report snapshot.');
  return supplementalWipProjects(snapshot, occupiedProjectIds);
}
