export type FinancialWipProjectInput = {
  qboCustomerId: string;
  projectName: string;
  customerName: string | null;
  procoreProjectId: string | null;
  procoreProjectNumber: string | null;
  procoreProjectName: string | null;
  procoreStatus: string | null;
  contractValue: number | null;
  contractValueSource: string;
  netBilled: number | null;
  ytdBilled: number | null;
  revenueOnly: boolean;
  openReceivables: {
    current: number;
    days1To30: number;
    days31To60: number;
    days61To90: number;
    days91AndOver: number;
    total: number;
  } | null;
  billingProgressPercent: number | null;
};

export type FinancialWipProject = FinancialWipProjectInput & {
  remainingToBill: number | null;
  unbilledDollars: number;
  overbilledDollars: number;
};

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isInternalFinancialProject(project: {
  projectName?: string | null;
  procoreProjectName?: string | null;
  procoreProjectNumber?: string | null;
}) {
  const normalize = (value: string | null | undefined) => String(value || "").trim().toLowerCase();
  return normalize(project.procoreProjectNumber) === "pmc-ops"
    || normalize(project.projectName) === "pmc operations"
    || normalize(project.procoreProjectName) === "pmc operations";
}

export function projectNumberYear(projectNumber: unknown): number | null {
  const value = String(projectNumber || "").trim();
  if (!value) return null;

  const fourDigitYear = value.match(/(?:^|\D)(20\d{2})(?=\D|$)/)?.[1];
  if (fourDigitYear) return Number(fourDigitYear);

  const leadingJobYear = value.match(/^(\d{2})\d{2}(?=\D|$)/)?.[1];
  if (leadingJobYear) return 2000 + Number(leadingJobYear);

  const separatedJobYear = value.match(/(?:^|\D)(\d{2})(?=\D|$)/)?.[1];
  return separatedJobYear ? 2000 + Number(separatedJobYear) : null;
}

export function projectNumberMatchesYear(projectNumber: unknown, year: number): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= 2099
    && projectNumberYear(projectNumber) === year;
}

// Keep the recorded calendar date, including at year boundaries with offsets.
export function financialDate(value: unknown): string | null {
  const text = value instanceof Date
    ? Number.isNaN(value.getTime()) ? "" : value.toISOString()
    : typeof value === "string" ? value.trim() : "";
  const match = text.match(/^(20\d{2})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match || !Number.isFinite(Date.parse(text))) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === text.slice(0, 10) ? text.slice(0, 10) : null;
}

type SoldYearInput = {
  contractDate?: unknown;
  procoreProjectNumber: unknown;
  startDate?: unknown;
};

export function resolveSoldYear(project: SoldYearInput) {
  const contractDate = financialDate(project.contractDate);
  const jobYear = projectNumberYear(project.procoreProjectNumber);
  const startDate = financialDate(project.startDate);
  if (contractDate) return { soldYear: Number(contractDate.slice(0, 4)), soldYearSource: "contract_date" as const };
  if (jobYear != null) return { soldYear: jobYear, soldYearSource: "project_number" as const };
  if (startDate) return { soldYear: Number(startDate.slice(0, 4)), soldYearSource: "start_date" as const };
  return { soldYear: null, soldYearSource: null };
}

export function financialSoldDates(
  contracts: Array<{
    company_id: string | null; project_procore_id: string | null; project_id: string | null;
    status: string | null; contract_date: unknown; payload: unknown;
  }>,
  projects: Array<{
    companyId: string; source: string; externalId: string; procoreProjectId: string | null; payload: unknown;
  }>,
  companyId: string,
) {
  const dates = new Map<string, { contractDate: string | null; startDate: string | null }>();
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  for (const row of contracts) {
    const payload = record(row.payload);
    if (row.company_id !== companyId || payload.deleted_at
      || !["approved", "executed"].includes(String(row.status || "").trim().toLowerCase())) continue;
    const id = String(row.project_procore_id || row.project_id || "").trim();
    const date = financialDate(row.contract_date) || financialDate(payload.contract_date);
    if (!id || !date) continue;
    const previous = dates.get(id);
    // A project's first approved contract determines its sold year, even when
    // additional contracts were entered later. Never join by name/job number.
    if (!previous?.contractDate || date < previous.contractDate) {
      dates.set(id, { contractDate: date, startDate: previous?.startDate ?? null });
    }
  }
  for (const row of projects) {
    if (row.companyId !== companyId || row.source !== "procore_v1_projects") continue;
    const id = String(row.procoreProjectId || row.externalId || "").trim();
    const payload = record(row.payload);
    if (!id || payload.deleted_at) continue;
    dates.set(id, { contractDate: dates.get(id)?.contractDate ?? null, startDate: financialDate(payload.start_date) });
  }
  return dates;
}

export function calculateSoldContractValue(
  projects: Array<SoldYearInput & { contractValue: unknown }>,
  year: number,
) {
  const soldProjects = projects.filter((project) =>
    Number.isInteger(year) && year >= 2000 && year <= 2099 && resolveSoldYear(project).soldYear === year
  );
  const contractProjects = soldProjects
    .map((project) => finiteNumber(project.contractValue))
    .filter((value): value is number => value != null);

  return {
    year,
    projectCount: soldProjects.length,
    contractProjectCount: contractProjects.length,
    contractValue: roundCurrency(
      contractProjects.reduce((sum, value) => sum + value, 0),
    ),
  };
}

type SoldEstimateInput = {
  bidBoardId: string;
  procoreProjectId?: string | null;
  projectNumber?: string;
  projectName?: string;
  status?: string;
  projectArchived: boolean;
  sales: unknown;
  originalContractValue?: number | null;
  contractDate?: unknown;
  startDate?: unknown;
  approvedChangeOrderAmount: unknown;
  customFields?: Record<string, unknown>;
};

export function calculateEstimatingSoldContracts(projects: SoldEstimateInput[], year: number) {
  const soldStatuses = new Set([
    "accepted", "awarded", "in progress", "active", "course of construction",
    "complete", "completed", "post-construction",
  ]);
  const seen = new Set<string>();
  const rows = [];
  for (const project of projects) {
    const soldYear = resolveSoldYear({ ...project, procoreProjectNumber: project.projectNumber });
    if (project.projectArchived
      || !soldStatuses.has(String(project.status || "").trim().toLowerCase())
      || !Number.isInteger(year) || year < 2000 || year > 2099
      || soldYear.soldYear !== year) continue;

    // The caller supplies one company's current estimating records. Accepted
    // jobs may only have a Bid Board ID; never join them by name or job number.
    const procoreId = String(project.procoreProjectId || "").trim();
    const boardId = String(project.bidBoardId || "").trim();
    if (!procoreId && !boardId) continue;
    const id = procoreId ? `procore:${procoreId}` : `bid:${boardId}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const baseEstimate = project.originalContractValue !== undefined
      ? finiteNumber(project.originalContractValue)
      : project.customFields?.estimatingSource === "no estimate"
        ? null : finiteNumber(project.sales);
    const approvedChangeOrders = finiteNumber(project.approvedChangeOrderAmount) ?? 0;
    rows.push({
      id,
      procoreProjectId: procoreId || null,
      bidBoardId: boardId,
      procoreProjectNumber: project.projectNumber || null,
      projectName: project.projectName || "Unnamed Project",
      status: project.status || null,
      contractDate: financialDate(project.contractDate),
      startDate: financialDate(project.startDate),
      ...soldYear,
      baseEstimate: baseEstimate == null ? null : roundCurrency(baseEstimate),
      approvedChangeOrders: roundCurrency(approvedChangeOrders),
      contractValue: baseEstimate == null ? null : roundCurrency(baseEstimate + approvedChangeOrders),
    });
  }
  return {
    ...calculateSoldContractValue(rows, year),
    projects: rows.sort((left, right) => left.projectName.localeCompare(right.projectName)),
  };
}

export function calculateFinancialWip(
  projects: FinancialWipProjectInput[],
  averageMonthlyBilled: unknown,
) {
  const rows: FinancialWipProject[] = projects.map((project) => {
    const contractValue = finiteNumber(project.contractValue);
    const netBilled = finiteNumber(project.netBilled);
    const remainingToBill = contractValue == null || netBilled == null
      ? null
      : roundCurrency(contractValue - netBilled);
    return {
      ...project,
      contractValue,
      netBilled,
      remainingToBill,
      unbilledDollars: remainingToBill == null ? 0 : Math.max(remainingToBill, 0),
      overbilledDollars: remainingToBill == null ? 0 : Math.max(-remainingToBill, 0),
    };
  });
  const included = rows.filter((project) =>
    project.contractValue != null && project.netBilled != null
  );
  const contractProjects = rows.filter((project) => project.contractValue != null);
  const billedProjects = rows.filter((project) => project.netBilled != null);
  const revenueOnlyProjects = billedProjects.filter((project) =>
    project.contractValue == null && project.revenueOnly
  );
  const billedWithoutContract = billedProjects.filter((project) =>
    project.contractValue == null && !project.revenueOnly
  );
  const monthlyBilled = finiteNumber(averageMonthlyBilled) ?? 0;
  const contractValue = roundCurrency(
    contractProjects.reduce((sum, project) => sum + (project.contractValue ?? 0), 0),
  );
  const netBilled = roundCurrency(
    billedProjects.reduce((sum, project) => sum + (project.netBilled ?? 0), 0),
  );
  const contractBackedNetBilled = roundCurrency(
    included.reduce((sum, project) => sum + (project.netBilled ?? 0), 0),
  );
  const unbilledDollars = roundCurrency(
    included.reduce((sum, project) => sum + project.unbilledDollars, 0),
  );
  const overbilledDollars = roundCurrency(
    included.reduce((sum, project) => sum + project.overbilledDollars, 0),
  );

  return {
    summary: {
      projectCount: rows.length,
      includedProjectCount: included.length,
      unavailableProjectCount: rows.length - included.length,
      contractProjectCount: contractProjects.length,
      billedProjectCount: billedProjects.length,
      billedWithoutContractProjectCount: billedWithoutContract.length,
      billedWithoutContractDollars: roundCurrency(
        billedWithoutContract.reduce((sum, project) => sum + (project.netBilled ?? 0), 0),
      ),
      revenueOnlyProjectCount: revenueOnlyProjects.length,
      revenueOnlyBilledDollars: roundCurrency(
        revenueOnlyProjects.reduce((sum, project) => sum + (project.netBilled ?? 0), 0),
      ),
      contractValue,
      netBilled,
      contractBackedNetBilled,
      unbilledDollars,
      overbilledDollars,
      averageMonthlyBilled: roundCurrency(monthlyBilled),
      leadTimeMonths: monthlyBilled > 0
        ? unbilledDollars / monthlyBilled
        : null,
    },
    projects: rows.sort((left, right) =>
      right.unbilledDollars - left.unbilledDollars
      || left.projectName.localeCompare(right.projectName)
    ),
  };
}

export function calculateQboIncomeReconciliation({
  companyIncome,
  incomeByCustomerId,
  projectCustomerIds,
  selectedProjectCustomerIds,
}: {
  companyIncome: unknown;
  incomeByCustomerId: Record<string, unknown>;
  projectCustomerIds: string[];
  selectedProjectCustomerIds: string[];
}) {
  const company = finiteNumber(companyIncome) ?? 0;
  const selectedIds = new Set(selectedProjectCustomerIds);
  const sumIds = (ids: string[]) => ids.reduce(
    (sum, id) => sum + (finiteNumber(incomeByCustomerId[id]) ?? 0),
    0,
  );
  const selectedProjectIncome = roundCurrency(sumIds(projectCustomerIds.filter((id) => selectedIds.has(id))));
  const filteredProjectIncome = roundCurrency(sumIds(projectCustomerIds.filter((id) => !selectedIds.has(id))));
  const nonProjectIncome = roundCurrency(company - selectedProjectIncome - filteredProjectIncome);
  const reconciledTotal = roundCurrency(selectedProjectIncome + filteredProjectIncome + nonProjectIncome);

  return {
    companyIncome: roundCurrency(company),
    selectedProjectIncome,
    filteredProjectIncome,
    nonProjectIncome,
    reconciledTotal,
    difference: roundCurrency(company - reconciledTotal),
  };
}
