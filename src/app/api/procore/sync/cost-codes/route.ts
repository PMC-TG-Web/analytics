import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { procoreConfig } from "@/lib/procore";

const DEFAULT_PROJECT_ID = "598134326278124";
const DEFAULT_PER_PAGE = 100;

async function ensureProcoreCostCodeStagingTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_cost_code_staging (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      sub_job_id TEXT NULL,
      cost_code_id TEXT NOT NULL,
      parent_id TEXT NULL,
      origin_id TEXT NULL,
      code TEXT NULL,
      full_code TEXT NULL,
      name TEXT NULL,
      active BOOLEAN NULL,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, project_id, sub_job_id, cost_code_id)
    )
  `);
}

async function upsertProcoreCostCode(params: {
  companyId: string;
  projectId: string;
  subJobId?: string | null;
  costCodeId: string;
  parentId?: string | null;
  originId?: string | null;
  code?: string | null;
  fullCode?: string | null;
  name?: string | null;
  active?: boolean | null;
  payload: unknown;
}) {
  const {
    companyId,
    projectId,
    subJobId,
    costCodeId,
    parentId,
    originId,
    code,
    fullCode,
    name,
    active,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_cost_code_staging
        (company_id, project_id, sub_job_id, cost_code_id, parent_id, origin_id, code, full_code, name, active, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW())
      ON CONFLICT (company_id, project_id, sub_job_id, cost_code_id)
      DO UPDATE SET
        parent_id = EXCLUDED.parent_id,
        origin_id = EXCLUDED.origin_id,
        code = EXCLUDED.code,
        full_code = EXCLUDED.full_code,
        name = EXCLUDED.name,
        active = EXCLUDED.active,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    companyId,
    projectId,
    subJobId ?? null,
    costCodeId,
    parentId ?? null,
    originId ?? null,
    code ?? null,
    fullCode ?? null,
    name ?? null,
    active ?? null,
    JSON.stringify(payload)
  );
}

type ProcoreCostCode = {
  id?: string | number | null;
  parent_id?: string | number | null;
  origin_id?: string | null;
  code?: string | null;
  full_code?: string | null;
  name?: string | null;
  active?: boolean | null;
};

async function fetchCostCodePage(url: string, accessToken: string, companyId: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken.trim()}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Procore API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("procore_access_token")?.value || body.accessToken;
    const companyId = String(body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || "").trim();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID).trim();
    const subJobId = String(body.subJobId || "").trim();
    const originId = String(body.originId || "").trim();
    const view = String(body.view || "").trim();
    const perPage = Math.max(1, Math.min(1000, Number(body.perPage) || DEFAULT_PER_PAGE));
    const parsedFilterIds = Array.isArray(body.filterIds)
      ? body.filterIds.map((value: unknown) => String(value).trim()).filter(Boolean)
      : String(body.filterIds || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Please authenticate via OAuth first or provide an access token." },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing company ID. Set PROCORE_COMPANY_ID or authenticate with a company-scoped session." },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
    }

    await ensureProcoreCostCodeStagingTable();

    const allItems: ProcoreCostCode[] = [];
    let currentPage = 1;

    while (true) {
      const params = new URLSearchParams({
        project_id: projectId,
        page: String(currentPage),
        per_page: String(perPage),
      });

      if (subJobId) params.set("sub_job_id", subJobId);
      if (originId) params.set("filters[origin_id]", originId);
      if (view) params.set("view", view);
      parsedFilterIds.forEach((id) => params.append("filters[id][]", id));

      const url = `${procoreConfig.apiUrl}/rest/v1.0/cost_codes?${params.toString()}`;
      const json = await fetchCostCodePage(url, accessToken, companyId);
      const items = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];

      if (items.length === 0) break;

      allItems.push(...items);

      for (const item of items as ProcoreCostCode[]) {
        const costCodeId = String(item.id ?? "").trim();
        if (!costCodeId) continue;

        await upsertProcoreCostCode({
          companyId,
          projectId,
          subJobId: subJobId || null,
          costCodeId,
          parentId: item.parent_id != null ? String(item.parent_id) : null,
          originId: item.origin_id ?? null,
          code: item.code ?? null,
          fullCode: item.full_code ?? null,
          name: item.name ?? null,
          active: typeof item.active === "boolean" ? item.active : null,
          payload: item,
        });
      }

      if (items.length < perPage) break;
      currentPage += 1;
    }

    const insertedRows = await prisma.$queryRawUnsafe<Array<{ row_count: bigint }>>(
      `
        SELECT COUNT(*)::bigint AS row_count
        FROM procore_cost_code_staging
        WHERE company_id = $1
          AND project_id = $2
          AND ((CAST($3 AS TEXT) IS NULL AND sub_job_id IS NULL) OR sub_job_id = CAST($3 AS TEXT))
      `,
      companyId,
      projectId,
      subJobId || null
    );

    return NextResponse.json({
      success: true,
      table: "procore_cost_code_staging",
      companyId,
      projectId,
      subJobId: subJobId || null,
      totalFetched: allItems.length,
      totalRowsInScope: Number(insertedRows[0]?.row_count || 0),
      sample: allItems.slice(0, 3),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore cost codes sync API error:", message);

    return NextResponse.json(
      {
        error: "Failed to sync Procore cost codes",
        details: message,
      },
      { status: 500 }
    );
  }
}