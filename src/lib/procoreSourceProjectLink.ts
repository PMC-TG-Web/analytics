type ExistingSourceProjectLink = {
  projectId?: string | null;
  jobKey?: string | null;
};

type ResolvedLegacyProject = {
  id: string;
  projectNumber?: string | null;
};

/** Keep historical attachments intact; correcting them requires a reviewed repair. */
export function selectProcoreSourceProjectLink(
  existing: ExistingSourceProjectLink | null | undefined,
  project: ResolvedLegacyProject | null,
  jobKeyMode: "id" | "number",
) {
  if (existing?.projectId) {
    return {
      projectId: existing.projectId,
      jobKey: existing.jobKey,
      conflict: Boolean(project && existing.projectId !== project.id),
      update: { projectId: undefined, jobKey: undefined },
    };
  }

  if (!project) {
    return {
      projectId: undefined,
      jobKey: existing?.jobKey,
      conflict: false,
      update: { projectId: undefined, jobKey: undefined },
    };
  }

  const jobKey = jobKeyMode === "number" ? project.projectNumber || project.id : project.id;
  return {
    projectId: project.id,
    jobKey,
    conflict: false,
    update: { projectId: project.id, jobKey },
  };
}

export function reportProcoreSourceProjectLinkConflicts(
  source: string,
  identity: { companyId?: string; projectId: string },
  conflictCount: number,
) {
  if (!conflictCount) return;
  console.warn("[ProcoreProjectIdentity] Existing source links require review", {
    source,
    companyId: identity.companyId || null,
    projectId: identity.projectId,
    conflictCount,
  });
}
