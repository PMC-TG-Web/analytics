import {
  resolveBidBoardLegacyProject,
  resolveProcoreLegacyProject,
} from "./procoreLegacyProjectIdentity";

type ProjectHeader = {
  companyId: string;
  projectName: string;
  projectNumber?: string | null;
  customer: string | null;
  status: string | null;
  statusRaw: string | null;
  source: string;
};

function customFields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Preserve local scheduling IDs and let the identity resolver own all links. */
export async function syncLegacyProcoreProjectHeader(params: ProjectHeader & {
  procoreProjectId: string;
}) {
  return resolveProcoreLegacyProject({
    companyId: params.companyId,
    projectId: params.procoreProjectId,
    projectName: params.projectName,
    projectNumber: params.projectNumber,
    createProjectIfMissing: true,
    source: params.source,
    updateProject: async (tx, project) => {
      const existing = customFields(project.customFields);
      const nowIso = new Date().toISOString();
      return tx.project.update({
        where: { id: project.id },
        data: {
          projectNumber: project.projectNumber || params.projectNumber,
          customer: params.customer || project.customer || null,
          customerSource: params.customer ? params.source : project.customerSource,
          status: params.status || project.status,
          statusSource: params.status ? "procore_v1_mapped" : project.statusSource,
          customFields: {
            ...existing,
            customerLabel: params.customer || (existing.customerLabel as string | null) || null,
            statusRaw: params.statusRaw,
            bidBoardStatus: params.status,
            statusSyncedAt: nowIso,
            syncedFrom: params.source,
            syncedAt: nowIso,
          },
        },
      });
    },
  });
}

export async function syncLegacyBidBoardProjectHeader(params: ProjectHeader & {
  bidBoardId: string;
  procoreProjectId: string | null;
}) {
  return resolveBidBoardLegacyProject({
    companyId: params.companyId,
    bidBoardId: params.bidBoardId,
    procoreProjectId: params.procoreProjectId,
    projectName: params.projectName,
    projectNumber: params.projectNumber,
    createProjectIfMissing: true,
    source: params.source,
    updateProject: async (tx, project) => {
      const existing = customFields(project.customFields);
      const nowIso = new Date().toISOString();
      return tx.project.update({
        where: { id: project.id },
        data: {
          projectName: project.projectName || params.projectName,
          customer: params.customer || project.customer || null,
          customerSource: params.customer ? "procore_bid_board" : project.customerSource,
          status: params.status || project.status,
          statusSource: params.status ? "procore_bid_board" : project.statusSource,
          customFields: {
            ...existing,
            customerLabel: params.customer || (existing.customerLabel as string | null) || null,
            bidBoardStatus: params.status,
            bidBoardStatusRaw: params.statusRaw,
            statusSyncedAt: nowIso,
            syncedFrom: params.source,
            syncedAt: nowIso,
          },
        },
      });
    },
  });
}
