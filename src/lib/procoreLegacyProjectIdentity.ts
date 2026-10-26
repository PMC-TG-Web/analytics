import type { Prisma, Project } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type LegacyProjectIdentityResult = {
  project: Project | null;
  created: boolean;
  status: "linked" | "created" | "unresolved" | "conflict";
  reason?: string;
};

type ResolvedIdentity = { created: boolean; status: "linked" | "created" };
type CommonIdentityParams = {
  companyId: string | null | undefined;
  projectName?: string | null;
  projectNumber?: string | null;
  createProjectIfMissing?: boolean;
  source?: string;
  updateProject?: (tx: Prisma.TransactionClient, project: Project, resolution: ResolvedIdentity) => Promise<Project>;
};

export type ProcoreLegacyProjectParams = CommonIdentityParams & {
  projectId: string;
  bidBoardId?: string | null;
};
export type BidBoardLegacyProjectParams = CommonIdentityParams & {
  bidBoardId: string;
  procoreProjectId?: string | null;
};

export type LegacyProjectIdentityInput = {
  companyId: string | null | undefined;
  projectId?: string | null;
  bidBoardId?: string | null;
};
type IdentityProject = Pick<Project, "id" | "procoreId" | "bidBoardId" | "customFields">;
type ProjectLink = { companyId: string; procoreProjectId: string; projectId: string };
type BidBoardLink = { companyId: string; bidBoardId: string; projectId: string };
export type LegacyProjectIdentitySnapshot = {
  projects: IdentityProject[];
  canonicalProjects: Array<{ companyId: string; procoreProjectId: string }>;
  canonicalBidBoards: Array<{ companyId: string; bidBoardId: string; procoreProjectId: string | null }>;
  projectLinks?: ProjectLink[];
  bidBoardLinks?: BidBoardLink[];
};
export type LegacyProjectIdentityDecision = {
  projectId: string | null;
  status: "linked" | "unresolved" | "conflict";
  reason?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function identityText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return "";
}

function identityValues(values: unknown[]): { values: string[]; malformed: boolean } {
  return {
    values: [...new Set(values.map(identityText).filter(Boolean))],
    malformed: values.some(value => value != null && value !== "" && !identityText(value)),
  };
}

function projectEvidence(project: IdentityProject) {
  const fields = record(project.customFields);
  return {
    projects: identityValues([project.procoreId, fields.procoreId, fields.procoreProjectId, fields.procore_project_id]),
    bids: identityValues([project.bidBoardId, fields.bidBoardId, fields.bid_board_id]),
    companies: identityValues([fields.procoreCompanyId, fields.companyId, fields.procore_company_id, fields.company_id]),
    retired: Boolean(fields.mergedBy || fields.mergedIntoProcoreId || fields.mergedIntoProjectId),
  };
}

function unresolved(reason: string, status: "unresolved" | "conflict" = "conflict"): LegacyProjectIdentityDecision {
  return { projectId: null, status, reason };
}

function canonicalProjectForBid(companyId: string, bidBoardId: string, bids: LegacyProjectIdentitySnapshot["canonicalBidBoards"]): string {
  const matches = bids.filter(bid => bid.companyId === companyId && bid.bidBoardId === bidBoardId);
  return matches.length === 1 ? identityText(matches[0].procoreProjectId) : "";
}

/** Pure, read-only classification also used by pre-release audits. */
export function classifyLegacyProjectIdentity(
  input: LegacyProjectIdentityInput,
  snapshot: LegacyProjectIdentitySnapshot,
): LegacyProjectIdentityDecision {
  const companyId = identityText(input.companyId);
  const bidBoardId = identityText(input.bidBoardId);
  const projectId = identityText(input.projectId) || canonicalProjectForBid(companyId, bidBoardId, snapshot.canonicalBidBoards);
  if (!companyId || (!projectId && !bidBoardId)) {
    return unresolved(!companyId ? "missing-company-id" : "missing-project-id", "unresolved");
  }
  const projectLinks = snapshot.projectLinks || [];
  const bidLinks = snapshot.bidBoardLinks || [];
  const relatedBidIds = new Set(bidBoardId ? [bidBoardId] : snapshot.canonicalBidBoards
    .filter(bid => projectId && bid.companyId === companyId && bid.procoreProjectId === projectId)
    .map(bid => bid.bidBoardId));
  const scopedProjectLinks = projectLinks.filter(link => link.companyId === companyId && link.procoreProjectId === projectId);
  const scopedBidLinks = bidLinks.filter(link => link.companyId === companyId && relatedBidIds.has(link.bidBoardId));
  const linkedIds = new Set([...scopedProjectLinks, ...scopedBidLinks].map(link => link.projectId));
  if (linkedIds.size > 1) return unresolved("conflicting-project-bridges");

  // Bid Board and Procore project IDs are distinct namespaces. Only the saved
  // explicit relationship allows a bid to become a project on the same row.
  if (projectId && bidBoardId) {
    const relationships = snapshot.canonicalBidBoards.filter(bid => bid.companyId === companyId && bid.bidBoardId === bidBoardId);
    if (relationships.length !== 1 || relationships[0].procoreProjectId !== projectId) {
      return unresolved("unverified-bid-project-relationship", "unresolved");
    }
  }

  const candidates: IdentityProject[] = [];
  for (const project of snapshot.projects) {
    const evidence = projectEvidence(project);
    const matchesProject = Boolean(projectId && evidence.projects.values.includes(projectId));
    const matchedBidId = evidence.bids.values.find(id => relatedBidIds.has(id));
    const matchesBid = Boolean(matchedBidId);
    const isLinked = linkedIds.has(project.id);
    if (!matchesProject && !matchesBid && !isLinked) continue;
    // Foreign-company rows remain separate even when external ID strings agree.
    if (!evidence.companies.malformed && evidence.companies.values.length === 1
      && evidence.companies.values[0] !== companyId && !isLinked) continue;
    if (evidence.projects.malformed || evidence.projects.values.length > 1
      || (projectId && evidence.projects.values.length && !matchesProject)) return unresolved("conflicting-project-ids");
    if (evidence.bids.malformed || evidence.bids.values.length > 1
      || (bidBoardId && evidence.bids.values.length && !matchesBid)) return unresolved("conflicting-bid-board-ids");
    if (!matchesProject && !matchesBid) return unresolved("missing-bridge-target-identity");
    if (evidence.companies.malformed || evidence.companies.values.length > 1
      || (evidence.companies.values.length === 1 && evidence.companies.values[0] !== companyId)) {
      return unresolved("conflicting-company-ids");
    }
    if (evidence.retired) return unresolved("retired-legacy-project");
    if (!evidence.companies.values.length && !isLinked) {
      const companies = new Set(matchesProject
        ? snapshot.canonicalProjects.filter(canonical => canonical.procoreProjectId === projectId).map(canonical => canonical.companyId)
        : snapshot.canonicalBidBoards.filter(canonical => canonical.bidBoardId === matchedBidId).map(canonical => canonical.companyId));
      if (companies.size !== 1 || !companies.has(companyId)) return unresolved("unverified-legacy-company", "unresolved");
    }
    candidates.push(project);
  }
  if (candidates.length > 1) return unresolved("ambiguous-legacy-projects");
  const candidate = candidates[0];
  if (linkedIds.size && (!candidate || !linkedIds.has(candidate.id))) return unresolved("missing-project-bridge-target");
  if (!candidate) return unresolved("project-not-linked", "unresolved");
  const candidateLinks = projectLinks.filter(link => link.projectId === candidate.id);
  if (candidateLinks.some(link => link.companyId !== companyId || (projectId && link.procoreProjectId !== projectId))) {
    return unresolved("legacy-project-already-linked");
  }
  if (bidLinks.some(link => link.projectId === candidate.id && link.companyId !== companyId)) {
    return unresolved("legacy-project-already-linked");
  }
  return { projectId: candidate.id, status: "linked" };
}

function exactMatchers(projectId: string, bidBoardId: string): Prisma.ProjectWhereInput[] {
  const matchers: Prisma.ProjectWhereInput[] = [];
  for (const [value, column, fields] of [
    [projectId, "procoreId", ["procoreId", "procoreProjectId", "procore_project_id"]],
    [bidBoardId, "bidBoardId", ["bidBoardId", "bid_board_id"]],
  ] as const) {
    if (!value) continue;
    const values: Array<string | number> = [value];
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric > 0 && String(numeric) === value) values.push(numeric);
    matchers.push({ [column]: value });
    for (const field of fields) for (const entry of values) matchers.push({ customFields: { path: [field], equals: entry } });
  }
  return matchers;
}

function assertIdentityUnchanged(before: Project, after: Project) {
  const oldEvidence = projectEvidence(before);
  const newEvidence = projectEvidence(after);
  const oldFields = record(before.customFields);
  const newFields = record(after.customFields);
  if (before.id !== after.id || newEvidence.retired !== oldEvidence.retired
    || before.procoreId !== after.procoreId || before.bidBoardId !== after.bidBoardId
    || ["procoreId", "procoreProjectId", "procore_project_id", "bidBoardId", "bid_board_id", "procoreCompanyId", "companyId", "procore_company_id", "company_id"]
      .some(key => identityText(oldFields[key]) !== identityText(newFields[key]))
    || ["projects", "bids", "companies"].some(key => {
      const oldValue = oldEvidence[key as "projects" | "bids" | "companies"];
      const newValue = newEvidence[key as "projects" | "bids" | "companies"];
      return newValue.malformed || oldValue.values.length !== newValue.values.length
        || oldValue.values.some(value => !newValue.values.includes(value));
    })) throw new Error("A project header update attempted to change its verified identity.");
}

async function resolveWithinTransaction(
  tx: Prisma.TransactionClient,
  params: CommonIdentityParams,
  companyId: string,
  projectId: string,
  bidBoardId: string,
): Promise<LegacyProjectIdentityResult> {
  const relatedCanonicalBids = await tx.pmcBidBoardProject.findMany({
    where: { OR: [
      ...(projectId ? [{ companyId, procoreProjectId: projectId }] : []),
      ...(bidBoardId ? [{ bidBoardId }] : []),
    ] }, select: { companyId: true, bidBoardId: true, procoreProjectId: true },
  });
  // Older or partial bid payloads may omit their project ID. Use only the
  // unique saved exact company/bid relationship before looking for a legacy
  // row, so those payloads cannot create a second row for an existing project.
  projectId ||= canonicalProjectForBid(companyId, bidBoardId, relatedCanonicalBids);
  const relatedBidIds = [...new Set(bidBoardId ? [bidBoardId] : relatedCanonicalBids.map(bid => bid.bidBoardId))];
  // Read every company for these exact bid IDs so a company-less legacy row
  // cannot borrow an ambiguous canonical company witness.
  const canonicalBidBoards = relatedBidIds.length ? await tx.pmcBidBoardProject.findMany({
    where: { bidBoardId: { in: relatedBidIds } }, select: { companyId: true, bidBoardId: true, procoreProjectId: true },
  }) : [];
  const projectBridge = projectId ? await tx.procoreLegacyProjectLink.findUnique({
    where: { companyId_procoreProjectId: { companyId, procoreProjectId: projectId } },
  }) : null;
  const relatedBidBridges = relatedBidIds.length ? await tx.procoreLegacyBidBoardLink.findMany({
    where: { companyId, bidBoardId: { in: relatedBidIds } },
  }) : [];
  const bidBridge = relatedBidBridges.find(link => link.bidBoardId === bidBoardId);
  const bridgeIds = [projectBridge?.projectId, ...relatedBidBridges.map(link => link.projectId)].filter((id): id is string => Boolean(id));
  const projects = await tx.project.findMany({ where: { OR: [
    ...exactMatchers(projectId, ""), ...relatedBidIds.flatMap(id => exactMatchers("", id)),
    ...(bridgeIds.length ? [{ id: { in: bridgeIds } }] : []),
  ] } });
  const ids = projects.map(project => project.id);
  const projectLinks = ids.length ? await tx.procoreLegacyProjectLink.findMany({ where: { projectId: { in: ids } } }) : [];
  const bidBoardLinks = ids.length ? await tx.procoreLegacyBidBoardLink.findMany({ where: { projectId: { in: ids } } }) : [];
  const canonicalProjects = projectId ? await tx.pmcProject.findMany({
    where: { procoreProjectId: projectId }, select: { companyId: true, procoreProjectId: true },
  }) : [];
  const decision = classifyLegacyProjectIdentity({ companyId, projectId, bidBoardId }, {
    projects, canonicalProjects, canonicalBidBoards,
    projectLinks: projectBridge && !projectLinks.some(link => link.projectId === projectBridge.projectId)
      ? [...projectLinks, projectBridge] : projectLinks,
    bidBoardLinks: [...bidBoardLinks, ...relatedBidBridges.filter(bridge =>
      !bidBoardLinks.some(link => link.companyId === bridge.companyId && link.bidBoardId === bridge.bidBoardId))],
  });
  if (decision.status !== "linked" && (decision.reason !== "project-not-linked" || !params.createProjectIfMissing)) {
    return { project: null, created: false, status: decision.status, reason: decision.reason };
  }
  let project = decision.projectId ? projects.find(candidate => candidate.id === decision.projectId)! : null;
  const created = !project;
  if (!project) {
    project = await tx.project.create({ data: {
      projectName: identityText(params.projectName) || (projectId ? `Procore Project ${projectId}` : `Procore Bid ${bidBoardId}`),
      projectNumber: identityText(params.projectNumber) || projectId || null,
      status: "Active",
      procoreId: projectId || null,
      bidBoardId: bidBoardId || null,
      customFields: {
        ...(projectId ? { procoreProjectId: projectId } : {}),
        ...(bidBoardId ? { bidBoardId } : {}),
        procoreCompanyId: companyId,
        source: params.source || "procore_identity_sync",
      },
    } });
  } else {
    // Fill missing compatibility markers only after exact identity is proved.
    // A bid-to-project transition keeps the existing local scheduling ID.
    const fields = record(project.customFields);
    if ((projectId && (!project.procoreId || !identityText(fields.procoreProjectId)))
      || (bidBoardId && (!project.bidBoardId || !identityText(fields.bidBoardId)))
      || !identityText(fields.procoreCompanyId)) {
      project = await tx.project.update({ where: { id: project.id }, data: {
        ...(projectId && !project.procoreId ? { procoreId: projectId } : {}),
        ...(bidBoardId && !project.bidBoardId ? { bidBoardId } : {}),
        customFields: {
          ...fields,
          ...(projectId && !identityText(fields.procoreProjectId) ? { procoreProjectId: projectId } : {}),
          ...(bidBoardId && !identityText(fields.bidBoardId) ? { bidBoardId } : {}),
          ...(!identityText(fields.procoreCompanyId) ? { procoreCompanyId: companyId } : {}),
        } as Prisma.InputJsonObject,
      } });
    }
  }
  if (projectId && !projectBridge) await tx.procoreLegacyProjectLink.create({ data: { companyId, procoreProjectId: projectId, projectId: project.id } });
  if (bidBoardId && !bidBridge) await tx.procoreLegacyBidBoardLink.create({ data: { companyId, bidBoardId, projectId: project.id } });
  const resolution: ResolvedIdentity = { created, status: created ? "created" : "linked" };
  if (params.updateProject) {
    const updated = await params.updateProject(tx, project, resolution);
    assertIdentityUnchanged(project, updated);
    project = updated;
  }
  return { project, ...resolution };
}

async function resolveIdentity(params: CommonIdentityParams, input: LegacyProjectIdentityInput): Promise<LegacyProjectIdentityResult> {
  const companyId = identityText(input.companyId);
  const projectId = identityText(input.projectId);
  const bidBoardId = identityText(input.bidBoardId);
  if (!companyId || (!projectId && !bidBoardId)) return {
    project: null, created: false, status: "unresolved", reason: !companyId ? "missing-company-id" : "missing-project-id",
  };
  let result: LegacyProjectIdentityResult | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await prisma.$transaction(tx => resolveWithinTransaction(tx, params, companyId, projectId, bidBoardId), {
        isolationLevel: "Serializable", maxWait: 5000, timeout: 15000,
      });
      break;
    } catch (error) {
      const code = record(error).code;
      if (attempt === 2 || (code !== "P2002" && code !== "P2034")) throw error;
    }
  }
  if (!result) throw new Error("Project identity resolution did not complete.");
  if (result.reason && result.reason !== "project-not-linked") {
    console.warn("[procore-project-identity]", { companyId, projectId: projectId || undefined, bidBoardId: bidBoardId || undefined, status: result.status, reason: result.reason });
  }
  return result;
}

/** Exact, company-scoped compatibility identity; never names or project numbers. */
export function resolveProcoreLegacyProject(params: ProcoreLegacyProjectParams): Promise<LegacyProjectIdentityResult> {
  if (!identityText(params.projectId)) return Promise.resolve({ project: null, created: false, status: "unresolved", reason: "missing-project-id" });
  return resolveIdentity(params, { companyId: params.companyId, projectId: params.projectId, bidBoardId: params.bidBoardId });
}

/** Bid Board IDs stay separate and become projects only through an explicit link. */
export function resolveBidBoardLegacyProject(params: BidBoardLegacyProjectParams): Promise<LegacyProjectIdentityResult> {
  if (!identityText(params.bidBoardId)) return Promise.resolve({ project: null, created: false, status: "unresolved", reason: "missing-bid-board-id" });
  return resolveIdentity(params, { companyId: params.companyId, projectId: params.procoreProjectId, bidBoardId: params.bidBoardId });
}
