import { prisma } from '@/lib/prisma';

export const PMC_COMPANY_ID = '598134325805519';

type LegacyProjectIdentity = {
  id: string;
  procoreId: string | null;
  bidBoardId: string | null;
  projectNumber: string | null;
  projectName: string;
  customer: string | null;
  status: string | null;
  projectArchived: boolean | null;
};

type PmcProjectIdentity = {
  companyId: string;
  procoreProjectId: string;
  bidBoardId: string | null;
  projectNumber: string | null;
  projectName: string;
  customer: string | null;
  status: string | null;
};

export type PmcProjectListRow = {
  id: string;
  sourceType: 'project' | 'bid_board' | 'linked';
  companyId: string;
  projectId: string | null;
  procoreProjectId: string | null;
  bidBoardId: string | null;
  customerCompanyId: string | null;
  projectNumber: string | null;
  projectName: string;
  customer: string | null;
  projectStatus: string | null;
  bidBoardStatus: string | null;
  status: string | null;
  hasProcoreProject: boolean;
  hasBidBoardProject: boolean;
  syncedAt: Date;
};

function clean(value: unknown) {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

function sameNullableText(left: unknown, right: unknown) {
  return clean(left) === clean(right);
}

export async function getPmcProjectIdentityRows(companyId = PMC_COMPANY_ID) {
  return prisma.pmcProject.findMany({
    where: { companyId },
    orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
    select: {
      companyId: true,
      procoreProjectId: true,
      bidBoardId: true,
      projectNumber: true,
      projectName: true,
      customer: true,
      status: true,
    },
  });
}

export async function getPmcBidBoardProjectRows(companyId = PMC_COMPANY_ID) {
  return prisma.pmcBidBoardProject.findMany({
    where: { companyId },
    orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
    select: {
      companyId: true,
      bidBoardId: true,
      procoreProjectId: true,
      projectNumber: true,
      projectName: true,
      customer: true,
      customerCompanyId: true,
      status: true,
      statusRaw: true,
      syncedAt: true,
    },
  });
}

export async function getPmcCombinedProjectRows(companyId = PMC_COMPANY_ID): Promise<PmcProjectListRow[]> {
  const [projects, bidBoardProjects] = await Promise.all([
    prisma.pmcProject.findMany({
      where: { companyId },
      orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
      select: {
        companyId: true,
        procoreProjectId: true,
        bidBoardId: true,
        projectNumber: true,
        projectName: true,
        customer: true,
        status: true,
        bidBoardStatus: true,
        syncedAt: true,
      },
    }),
    getPmcBidBoardProjectRows(companyId),
  ]);

  const projectsByProcoreId = new Map(projects.map((project) => [project.procoreProjectId, project]));
  const coveredProjectIds = new Set<string>();

  const rows: PmcProjectListRow[] = bidBoardProjects.map((bidBoardProject) => {
    const linkedProject = bidBoardProject.procoreProjectId
      ? projectsByProcoreId.get(bidBoardProject.procoreProjectId)
      : undefined;

    if (linkedProject) coveredProjectIds.add(linkedProject.procoreProjectId);

    const procoreProjectId = linkedProject?.procoreProjectId ?? bidBoardProject.procoreProjectId ?? null;
    const projectNumber = linkedProject?.projectNumber ?? bidBoardProject.projectNumber ?? null;
    const projectName = linkedProject?.projectName ?? bidBoardProject.projectName;
    const customer = linkedProject?.customer ?? bidBoardProject.customer ?? null;
    const projectStatus = linkedProject?.status ?? null;
    const bidBoardStatus = bidBoardProject.status ?? linkedProject?.bidBoardStatus ?? null;

    return {
      id: bidBoardProject.bidBoardId,
      sourceType: linkedProject ? 'linked' : 'bid_board',
      companyId: bidBoardProject.companyId,
      projectId: procoreProjectId,
      procoreProjectId,
      bidBoardId: bidBoardProject.bidBoardId,
      customerCompanyId: bidBoardProject.customerCompanyId,
      projectNumber,
      projectName,
      customer,
      projectStatus,
      bidBoardStatus,
      status: bidBoardStatus ?? projectStatus,
      hasProcoreProject: Boolean(procoreProjectId),
      hasBidBoardProject: true,
      syncedAt: bidBoardProject.syncedAt,
    };
  });

  for (const project of projects) {
    if (coveredProjectIds.has(project.procoreProjectId)) continue;

    rows.push({
      id: project.procoreProjectId,
      sourceType: 'project',
      companyId: project.companyId,
      projectId: project.procoreProjectId,
      procoreProjectId: project.procoreProjectId,
      bidBoardId: project.bidBoardId,
      customerCompanyId: null,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customer: project.customer,
      projectStatus: project.status,
      bidBoardStatus: project.bidBoardStatus,
      status: project.status,
      hasProcoreProject: true,
      hasBidBoardProject: Boolean(project.bidBoardId),
      syncedAt: project.syncedAt,
    });
  }

  return rows.sort((left, right) => {
    const leftNumber = left.projectNumber ?? '';
    const rightNumber = right.projectNumber ?? '';
    const numberCompare = leftNumber.localeCompare(rightNumber);
    if (numberCompare !== 0) return numberCompare;
    return left.projectName.localeCompare(right.projectName);
  });
}

export async function comparePmcProjectsToLegacy(companyId = PMC_COMPANY_ID) {
  const [legacyProjects, pmcProjects] = await Promise.all([
    prisma.project.findMany({
      orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
      select: {
        id: true,
        procoreId: true,
        bidBoardId: true,
        projectNumber: true,
        projectName: true,
        customer: true,
        status: true,
        projectArchived: true,
      },
    }),
    getPmcProjectIdentityRows(companyId),
  ]);

  const pmcByProcoreProjectId = new Map<string, PmcProjectIdentity>(
    pmcProjects.map((project) => [project.procoreProjectId, project]),
  );
  const legacyByProcoreProjectId = new Map<string, LegacyProjectIdentity[]>();

  for (const project of legacyProjects) {
    if (!project.procoreId) continue;
    const rows = legacyByProcoreProjectId.get(project.procoreId) ?? [];
    rows.push(project);
    legacyByProcoreProjectId.set(project.procoreId, rows);
  }

  const legacyMissingProcoreProjectId = legacyProjects
    .filter((project) => !project.procoreId)
    .map((project) => ({
      legacyProjectId: project.id,
      bidBoardId: project.bidBoardId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customer: project.customer,
      status: project.status,
      projectArchived: project.projectArchived,
    }));

  const missingInPmc = legacyProjects
    .filter((project) => project.procoreId && !pmcByProcoreProjectId.has(project.procoreId))
    .map((project) => ({
      legacyProjectId: project.id,
      procoreProjectId: project.procoreId,
      bidBoardId: project.bidBoardId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customer: project.customer,
      status: project.status,
    }));

  const missingInLegacy = pmcProjects
    .filter((project) => !legacyByProcoreProjectId.has(project.procoreProjectId))
    .map((project) => ({
      companyId: project.companyId,
      procoreProjectId: project.procoreProjectId,
      bidBoardId: project.bidBoardId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customer: project.customer,
      status: project.status,
    }));

  const duplicateLegacyProcoreProjectIds = [...legacyByProcoreProjectId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([procoreProjectId, rows]) => ({
      procoreProjectId,
      count: rows.length,
      legacyProjectIds: rows.map((row) => row.id),
    }));

  const fieldDifferences = [];
  for (const legacyProject of legacyProjects) {
    if (!legacyProject.procoreId) continue;
    const pmcProject = pmcByProcoreProjectId.get(legacyProject.procoreId);
    if (!pmcProject) continue;

    const fields: Array<keyof Pick<
      LegacyProjectIdentity,
      'bidBoardId' | 'projectNumber' | 'projectName' | 'customer' | 'status'
    >> = ['bidBoardId', 'projectNumber', 'projectName', 'customer', 'status'];

    for (const field of fields) {
      if (sameNullableText(legacyProject[field], pmcProject[field])) continue;
      fieldDifferences.push({
        procoreProjectId: legacyProject.procoreId,
        legacyProjectId: legacyProject.id,
        field,
        legacyValue: legacyProject[field],
        pmcValue: pmcProject[field],
      });
    }
  }

  return {
    companyId,
    generatedAt: new Date().toISOString(),
    summary: {
      legacyProjectCount: legacyProjects.length,
      legacyProjectsWithProcoreProjectId: legacyProjects.filter((project) => project.procoreId).length,
      legacyProjectsMissingProcoreProjectId: legacyMissingProcoreProjectId.length,
      pmcProjectCount: pmcProjects.length,
      missingInPmc: missingInPmc.length,
      missingInLegacy: missingInLegacy.length,
      duplicateLegacyProcoreProjectIds: duplicateLegacyProcoreProjectIds.length,
      fieldDifferences: fieldDifferences.length,
    },
    legacyMissingProcoreProjectId,
    missingInPmc,
    missingInLegacy,
    duplicateLegacyProcoreProjectIds,
    fieldDifferences,
  };
}
