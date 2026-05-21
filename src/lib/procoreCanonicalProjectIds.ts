import { prisma } from "@/lib/prisma";

export async function getCanonicalProjectIdsForCompany(companyId: string, limitProjects: number): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ project_id: string | null }>>(
    `
      SELECT DISTINCT COALESCE(procore_project_id, external_id) AS project_id
      FROM procore_project_staging
      WHERE company_id = $1
        AND source = 'procore_v1_projects'
        AND COALESCE(procore_project_id, external_id) IS NOT NULL
      ORDER BY project_id ASC
      LIMIT $2
    `,
    companyId,
    Math.max(1, Math.min(10000, limitProjects))
  );

  return rows
    .map((row) => String(row.project_id || "").trim())
    .filter((value) => value.length > 0);
}
