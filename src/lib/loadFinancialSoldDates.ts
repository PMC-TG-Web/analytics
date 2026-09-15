import { prisma } from "@/lib/prisma";
import { financialSoldDates } from "@/lib/financialWip";

export async function loadFinancialSoldDates(companyId: string) {
  const [contracts, projects] = await Promise.all([
    prisma.procore_prime_contracts_live.findMany({
      where: { company_id: companyId },
      select: {
        company_id: true, project_procore_id: true, project_id: true,
        status: true, contract_date: true, payload: true,
      },
    }),
    prisma.procoreProjectStaging.findMany({
      where: { companyId, source: "procore_v1_projects" },
      select: { companyId: true, source: true, externalId: true, procoreProjectId: true, payload: true },
    }),
  ]);
  return financialSoldDates(contracts, projects, companyId);
}
