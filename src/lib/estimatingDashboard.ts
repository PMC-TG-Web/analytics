import { prisma } from "@/lib/prisma";
import { getCachedValue, setCachedValue } from "@/lib/serverReadCache";
import {
  addEstimateLineAmounts,
  canonicalBidBoardId,
  classifyConcreteGroup,
  classifyEstimateCostType,
  classifyLaborGroup,
  concreteYardQuantity,
  numericValue,
  selectEstimateProposal,
} from "@/lib/estimatingDashboardLogic";

const COMPANY_ID = process.env.PROCORE_COMPANY_ID || "598134325805519";
const PROJECT_CACHE_KEY = `estimating-dashboard-projects:${COMPANY_ID}`;
const PROJECT_CACHE_TTL_MS = 60_000;

export type EstimatingDashboardProject = {
  id: string;
  bidBoardId: string;
  procoreProjectId?: string | null;
  selectedProposalId?: string | null;
  proposalName?: string | null;
  projectNumber?: string;
  projectName?: string;
  customer?: string;
  status?: string;
  sales: number;
  cost: number;
  hours: number;
  laborSales: number;
  laborCost: number;
  pmcGroup: Record<string, number>;
  pmcBreakdown: Record<string, number>;
  concreteGroup: Record<string, number>;
  dateCreated?: string | null;
  dateUpdated?: string | null;
  estimator?: string | null;
  projectManager?: string | null;
  projectStage?: string | null;
  projectArchived: boolean;
  dataSource: "procore-estimating";
  customFields: Record<string, unknown>;
};

type DashboardSummary = {
  totalSales: number;
  totalCost: number;
  totalHours: number;
  statusGroups: Record<string, {
    sales: number;
    cost: number;
    hours: number;
    count: number;
    laborByGroup: Record<string, number>;
    concreteByGroup: Record<string, number>;
  }>;
  contractors: Record<string, {
    sales: number;
    cost: number;
    hours: number;
    count: number;
    byStatus: Record<string, { sales: number; cost: number; hours: number; count: number }>;
  }>;
  pmcGroupHours: Record<string, number>;
  laborBreakdown: Record<string, number>;
  lastUpdated: string | null;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function newestDate(...values: unknown[]): string | null {
  let newest: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    const parsed = new Date(value as string | number | Date);
    if (Number.isNaN(parsed.getTime())) continue;
    if (!newest || parsed > newest) newest = parsed;
  }
  return newest?.toISOString() ?? null;
}

function isExcludedProject(project: EstimatingDashboardProject): boolean {
  if (project.projectArchived) return true;
  const status = clean(project.status).toLowerCase();
  if (["invitations", "to do", "todo", "to-do"].includes(status)) return true;
  if (clean(project.customer).toLowerCase().includes("sop inc")) return true;

  const name = clean(project.projectName).toLowerCase();
  if (["pmc operations", "pmc shop time", "pmc test project", "alexander drive addition latest"].includes(name)) return true;
  if (name.includes("sandbox") || name.includes("raymond king")) return true;
  if (clean(project.projectNumber).toLowerCase() === "701 poplar church rd") return true;
  return false;
}

export async function loadEstimatingDashboardProjects(options: { force?: boolean } = {}): Promise<EstimatingDashboardProject[]> {
  if (!options.force) {
    const cached = getCachedValue<EstimatingDashboardProject[]>(PROJECT_CACHE_KEY);
    if (cached) return cached;
  }

  const [boardRows, proposals, lineRows, pmcProjects, companyUsers, onboardingStates] = await Promise.all([
    prisma.pmcBidBoardProject.findMany({ where: { companyId: COMPANY_ID } }),
    prisma.procoreEstimateProposal.findMany({ where: { companyId: COMPANY_ID } }),
    prisma.procoreEstimateLineItem.findMany({
      where: { companyId: COMPANY_ID },
      select: {
        bidBoardProjectId: true,
        proposalId: true,
        name: true,
        groupId: true,
        costCode: true,
        uom: true,
        quantity: true,
        itemCost: true,
        itemSales: true,
        laborCost: true,
        laborSales: true,
        laborHours: true,
      },
    }),
    prisma.pmcProject.findMany({ where: { companyId: COMPANY_ID } }),
    prisma.procore_company_users_live.findMany({
      where: { company_id: COMPANY_ID },
      select: { user_id: true, name: true },
    }),
    prisma.procoreSyncProjectState.findMany({
      where: {
        companyId: COMPANY_ID,
        dataset: "project_onboarding",
      },
      select: {
        projectId: true,
        lastAttemptAt: true,
        lastSuccessAt: true,
        nextRunAt: true,
        failureCount: true,
        lastError: true,
      },
    }),
  ]);

  // Older imports prefixed the company ID to bid-board IDs. Those rows are
  // historical snapshots and can remain after a project leaves the live Bid
  // Board. Only unprefixed IDs are current Procore Bid Board records.
  const boardsById = new Map<string, typeof boardRows[number]>();
  for (const row of boardRows) {
    const id = canonicalBidBoardId(row.bidBoardId);
    if (row.bidBoardId !== id) continue;
    boardsById.set(id, row);
  }

  const proposalsByBoard = new Map<string, typeof proposals>();
  for (const proposal of proposals) {
    const id = canonicalBidBoardId(proposal.bidBoardProjectId);
    const values = proposalsByBoard.get(id) ?? [];
    values.push(proposal);
    proposalsByBoard.set(id, values);
  }

  const selectedByBoard = new Map<string, typeof proposals[number]>();
  for (const [id, values] of proposalsByBoard) {
    const selected = selectEstimateProposal(values);
    if (selected) selectedByBoard.set(id, selected);
  }

  const totalsByBoard = new Map<string, {
    sales: number;
    cost: number;
    hours: number;
    laborSales: number;
    laborCost: number;
    lineCount: number;
    laborByGroup: Record<string, number>;
    concreteByGroup: Record<string, number>;
  }>();

  const selectedLines = lineRows.filter((line) => {
    const boardId = canonicalBidBoardId(line.bidBoardProjectId);
    return selectedByBoard.get(boardId)?.proposalId === line.proposalId;
  });

  // A generic mix name such as "4000 PSI Concrete" inherits its placement
  // category from the production labor in the same Procore estimate group.
  const scopeLaborWeights = new Map<string, Record<string, number>>();
  for (const line of selectedLines) {
    const hours = numericValue(line.laborHours);
    if (hours <= 0 || !line.groupId) continue;
    const laborGroup = classifyLaborGroup(line);
    if (!["Slab On Grade Labor", "Site Concrete Labor", "Wall Labor", "Foundation Labor"].includes(laborGroup)) continue;
    const scopeKey = `${canonicalBidBoardId(line.bidBoardProjectId)}:${line.proposalId}:${line.groupId}`;
    const weights = scopeLaborWeights.get(scopeKey) ?? {};
    weights[laborGroup] = (weights[laborGroup] ?? 0) + hours;
    scopeLaborWeights.set(scopeKey, weights);
  }

  const scopeLaborGroup = new Map<string, string>();
  for (const [key, weights] of scopeLaborWeights) {
    const selected = Object.entries(weights).sort((left, right) => right[1] - left[1])[0]?.[0];
    if (selected) scopeLaborGroup.set(key, selected);
  }

  for (const line of selectedLines) {
    const boardId = canonicalBidBoardId(line.bidBoardProjectId);

    const totals = totalsByBoard.get(boardId) ?? {
      sales: 0,
      cost: 0,
      hours: 0,
      laborSales: 0,
      laborCost: 0,
      lineCount: 0,
      laborByGroup: {},
      concreteByGroup: {},
    };
    addEstimateLineAmounts(totals, line);
    totals.lineCount += 1;
    const hours = numericValue(line.laborHours);
    if (hours > 0) {
      const group = classifyLaborGroup(line);
      totals.laborByGroup[group] = (totals.laborByGroup[group] ?? 0) + hours;
    }
    const yards = concreteYardQuantity(line);
    if (yards > 0) {
      const scopeKey = line.groupId ? `${boardId}:${line.proposalId}:${line.groupId}` : "";
      const concreteGroup = classifyConcreteGroup(line, scopeLaborGroup.get(scopeKey));
      if (concreteGroup) {
        totals.concreteByGroup[concreteGroup] = (totals.concreteByGroup[concreteGroup] ?? 0) + yards;
      }
    }
    totalsByBoard.set(boardId, totals);
  }

  const pmcByProcore = new Map(pmcProjects.map((project) => [project.procoreProjectId, project]));
  const pmcByBoard = new Map(
    pmcProjects
      .filter((project) => project.bidBoardId)
      .map((project) => [canonicalBidBoardId(project.bidBoardId), project]),
  );
  const estimatorByUserId = new Map(companyUsers.map((user) => [user.user_id, clean(user.name)]));
  const onboardingByProjectId = new Map(onboardingStates.map((state) => [state.projectId, state]));

  const projects: EstimatingDashboardProject[] = [];
  for (const [boardId, board] of boardsById) {
    const payload = recordValue(board.payload);
    const selected = selectedByBoard.get(boardId);
    const proposalPayload = recordValue(selected?.payload);
    const totals = totalsByBoard.get(boardId) ?? {
      sales: 0,
      cost: 0,
      hours: 0,
      laborSales: 0,
      laborCost: 0,
      lineCount: 0,
      laborByGroup: {},
      concreteByGroup: {},
    };
    const linked = (board.procoreProjectId ? pmcByProcore.get(board.procoreProjectId) : undefined) ?? pmcByBoard.get(boardId);
    const bidBoardStats = recordValue(payload.stats);
    const hasBidBoardTotal = Object.prototype.hasOwnProperty.call(bidBoardStats, "total");
    const bidBoardSales = hasBidBoardTotal ? numericValue(bidBoardStats.total) : null;
    const proposalSales = numericValue(proposalPayload.total);
    const archived = Boolean(
      payload.archived
      || payload.deleted
      || payload.is_template
      || payload.sync_missing_from_procore
    );
    const procoreProjectId = board.procoreProjectId ?? selected?.procoreProjectId ?? linked?.procoreProjectId ?? null;
    const onboarding = procoreProjectId ? onboardingByProjectId.get(procoreProjectId) : undefined;
    const onboardingError = clean(onboarding?.lastError).toLowerCase();
    const onboardingStatus = onboarding?.lastSuccessAt
      ? "complete"
      : onboardingError.includes("estimate proposal line items")
        ? "waiting_for_estimate"
        : onboardingError.includes("bid board")
          ? "waiting_for_bid_board"
          : onboarding?.failureCount
            ? "retrying"
            : "queued";
    const project: EstimatingDashboardProject = {
      id: `bid:${boardId}`,
      bidBoardId: boardId,
      procoreProjectId,
      selectedProposalId: selected?.proposalId ?? null,
      proposalName: selected?.proposalName ?? null,
      projectNumber: clean(board.projectNumber || linked?.projectNumber),
      projectName: clean(board.projectName || selected?.projectName || linked?.projectName) || "Unnamed Project",
      customer: clean(board.customer || selected?.customerName || linked?.customer) || "Unknown",
      status: clean(board.status || linked?.bidBoardStatus || linked?.status) || "Unknown",
      // Procore's Bid Board header is calculated from stats.total. Use that as
      // the dashboard sales source so each status count and amount reconciles
      // exactly to Procore; normalized lines still supply cost and labor.
      sales: bidBoardSales ?? (totals.lineCount > 0 ? totals.sales : proposalSales),
      cost: totals.cost,
      hours: totals.hours,
      laborSales: totals.laborSales,
      laborCost: totals.laborCost,
      pmcGroup: totals.laborByGroup,
      pmcBreakdown: totals.laborByGroup,
      concreteGroup: totals.concreteByGroup,
      dateCreated: newestDate(payload.created_on, board.createdAt),
      dateUpdated: newestDate(payload.updated_at, selected?.sourceUpdatedAt, board.syncedAt, board.updatedAt),
      estimator: estimatorByUserId.get(clean(payload.estimator_user_id)) || linked?.estimator || null,
      projectManager: linked?.projectManager ?? null,
      projectStage: clean(board.status || linked?.bidBoardStatus || linked?.status) || null,
      projectArchived: archived,
      dataSource: "procore-estimating",
      customFields: {
        bidBoardId: boardId,
        procoreProjectId: board.procoreProjectId ?? selected?.procoreProjectId ?? null,
        selectedProposalId: selected?.proposalId ?? null,
        proposalName: selected?.proposalName ?? null,
        pmcGroup: totals.laborByGroup,
        concreteGroup: totals.concreteByGroup,
        estimateLineCount: totals.lineCount,
        estimatingSource: hasBidBoardTotal
          ? "bid-board total"
          : totals.lineCount > 0
            ? "normalized estimate lines"
            : proposalSales > 0
              ? "proposal total"
              : "no estimate",
        onboarding: onboarding
          ? {
              status: onboardingStatus,
              complete: Boolean(onboarding.lastSuccessAt),
              lastAttemptAt: onboarding.lastAttemptAt?.toISOString() ?? null,
              lastSuccessAt: onboarding.lastSuccessAt?.toISOString() ?? null,
              nextRunAt: onboarding.nextRunAt.toISOString(),
              failureCount: onboarding.failureCount,
            }
          : null,
      },
    };
    if (!isExcludedProject(project)) projects.push(project);
  }

  projects.sort((left, right) => clean(left.projectName).localeCompare(clean(right.projectName)));
  setCachedValue(PROJECT_CACHE_KEY, projects, PROJECT_CACHE_TTL_MS);
  return projects;
}

export function buildEstimatingDashboardSummary(projects: EstimatingDashboardProject[]): DashboardSummary {
  const summary: DashboardSummary = {
    totalSales: 0,
    totalCost: 0,
    totalHours: 0,
    statusGroups: {},
    contractors: {},
    pmcGroupHours: {},
    laborBreakdown: {},
    lastUpdated: null,
  };

  let latest = 0;
  for (const project of projects) {
    summary.totalSales += project.sales;
    summary.totalCost += project.cost;
    summary.totalHours += project.hours;

    const status = clean(project.status) || "Unknown";
    const statusGroup = summary.statusGroups[status] ?? {
      sales: 0,
      cost: 0,
      hours: 0,
      count: 0,
      laborByGroup: {},
      concreteByGroup: {},
    };
    statusGroup.sales += project.sales;
    statusGroup.cost += project.cost;
    statusGroup.hours += project.hours;
    statusGroup.count += 1;
    for (const [group, hours] of Object.entries(project.pmcGroup)) {
      statusGroup.laborByGroup[group] = (statusGroup.laborByGroup[group] ?? 0) + hours;
      summary.pmcGroupHours[group] = (summary.pmcGroupHours[group] ?? 0) + hours;
      summary.laborBreakdown[group] = (summary.laborBreakdown[group] ?? 0) + hours;
    }
    for (const [group, yards] of Object.entries(project.concreteGroup)) {
      statusGroup.concreteByGroup[group] = (statusGroup.concreteByGroup[group] ?? 0) + yards;
    }
    summary.statusGroups[status] = statusGroup;

    const contractorName = clean(project.customer) || "Unknown";
    const contractor = summary.contractors[contractorName] ?? {
      sales: 0,
      cost: 0,
      hours: 0,
      count: 0,
      byStatus: {},
    };
    contractor.sales += project.sales;
    contractor.cost += project.cost;
    contractor.hours += project.hours;
    contractor.count += 1;
    const contractorStatus = contractor.byStatus[status] ?? { sales: 0, cost: 0, hours: 0, count: 0 };
    contractorStatus.sales += project.sales;
    contractorStatus.cost += project.cost;
    contractorStatus.hours += project.hours;
    contractorStatus.count += 1;
    contractor.byStatus[status] = contractorStatus;
    summary.contractors[contractorName] = contractor;

    const updated = project.dateUpdated ? new Date(project.dateUpdated).getTime() : 0;
    if (Number.isFinite(updated) && updated > latest) latest = updated;
  }
  summary.lastUpdated = latest > 0 ? new Date(latest).toISOString() : null;
  return summary;
}

export async function loadEstimateLineItems(project: EstimatingDashboardProject) {
  if (!project.selectedProposalId) return [];
  const lines = await prisma.procoreEstimateLineItem.findMany({
    where: {
      companyId: COMPANY_ID,
      bidBoardProjectId: project.bidBoardId,
      proposalId: project.selectedProposalId,
    },
    orderBy: [{ groupName: "asc" }, { name: "asc" }, { lineItemId: "asc" }],
  });

  return lines.map((line) => {
    const payload = recordValue(line.payload);
    const costItem = recordValue(payload.cost_item);
    return {
      id: line.lineItemId,
      costitems: clean(costItem.name || line.name) || "Unknown",
      description: clean(costItem.description),
      costType: classifyEstimateCostType(line),
      quantity: numericValue(line.quantity),
      hours: numericValue(line.laborHours),
      cost: numericValue(line.itemCost) + numericValue(line.laborCost),
      sales: numericValue(line.itemSales) + numericValue(line.laborSales),
      laborCost: numericValue(line.laborCost),
      laborSales: numericValue(line.laborSales),
      costCode: clean(line.costCode || costItem.cost_code),
      uom: clean(line.uom || costItem.unit),
      pmcGroup: numericValue(line.laborHours) > 0 ? classifyLaborGroup(line) : null,
    };
  });
}
