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
  const monthlyBilled = finiteNumber(averageMonthlyBilled) ?? 0;
  const contractValue = roundCurrency(
    included.reduce((sum, project) => sum + (project.contractValue ?? 0), 0),
  );
  const netBilled = roundCurrency(
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
      contractValue,
      netBilled,
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
