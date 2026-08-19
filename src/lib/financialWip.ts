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

export function projectNumberMatchesYear(projectNumber: unknown, year: number): boolean {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) return false;
  const value = String(projectNumber || "").trim();
  if (!value) return false;

  const fourDigitYear = value.match(/(?:^|\D)(20\d{2})(?=\D|$)/)?.[1];
  if (fourDigitYear) return Number(fourDigitYear) === year;

  const twoDigitYear = String(year).slice(-2);
  const leadingJobYear = value.match(/^(\d{2})\d{2}(?=\D|$)/)?.[1];
  if (leadingJobYear) return leadingJobYear === twoDigitYear;

  const separatedJobYear = value.match(/(?:^|\D)(\d{2})(?=\D|$)/)?.[1];
  return separatedJobYear === twoDigitYear;
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
