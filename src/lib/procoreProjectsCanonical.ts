import { prisma } from "@/lib/prisma";

export type CanonicalProcoreProjectRow = {
  procore_project_id: string;
  name: string | null;
  project_number: string | null;
  status: string | null;
  status_raw: string | null;
  customer: string | null;
  stage_name: string | null;
  stage_category: string | null;
  bid_board_status: string | null;
  bid_board_id: string | null;
  synced_at: Date;
};

export type CanonicalProcoreProjectPayloadRow = {
  canonical_project_id: string;
  payload: unknown;
  synced_at: Date;
};

export async function fetchCanonicalProcoreProjects(params: {
  companyId: string;
  pageSize: number;
  offset: number;
}): Promise<CanonicalProcoreProjectRow[]> {
  const { companyId, pageSize, offset } = params;

  return prisma.$queryRawUnsafe<CanonicalProcoreProjectRow[]>(
    `
    WITH ranked AS (
      SELECT
        COALESCE(s.procore_project_id, s.external_id) AS procore_project_id,
        s.name,
        COALESCE(b.status, s.bid_board_status) AS status,
        s.status AS status_raw,
        s.customer,
        (s.payload ->> 'project_number')::text AS project_number,
        (s.payload -> 'project_stage' ->> 'name')::text AS stage_name,
        ps.category AS stage_category,
        COALESCE(b.status, s.bid_board_status) AS bid_board_status,
        b.bid_board_id,
        s.synced_at,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(s.procore_project_id, s.external_id)
          ORDER BY s.synced_at DESC
        ) AS rn
      FROM procore_project_staging s
      LEFT JOIN procore_project_stages_live ps
        ON ps.project_stage_id = (s.payload -> 'project_stage' ->> 'id')
      LEFT JOIN LATERAL (
        SELECT bb.status, bb.bid_board_id
        FROM procore_bid_board_live bb
        WHERE bb.procore_project_id = COALESCE(s.procore_project_id, s.external_id)
        ORDER BY bb.synced_at DESC
        LIMIT 1
      ) b ON TRUE
      WHERE s.source = 'procore_v1_projects'
        AND s.company_id = $1
        AND COALESCE(s.procore_project_id, s.external_id) IS NOT NULL
    )
    SELECT
      procore_project_id,
      name,
      project_number,
      status,
      status_raw,
      customer,
      stage_name,
      stage_category,
      bid_board_status,
      bid_board_id,
      synced_at
    FROM ranked
    WHERE rn = 1
    ORDER BY synced_at DESC
    LIMIT $2 OFFSET $3
    `,
    companyId,
    pageSize,
    offset
  );
}

export async function countCanonicalProcoreProjects(companyId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ total_count: bigint }>>(
    `
    WITH ranked AS (
      SELECT
        COALESCE(s.procore_project_id, s.external_id) AS procore_project_id,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(s.procore_project_id, s.external_id)
          ORDER BY s.synced_at DESC
        ) AS rn
      FROM procore_project_staging s
      WHERE s.source = 'procore_v1_projects'
        AND s.company_id = $1
        AND COALESCE(s.procore_project_id, s.external_id) IS NOT NULL
    )
    SELECT COUNT(*)::bigint AS total_count
    FROM ranked
    WHERE rn = 1
    `,
    companyId
  );

  return Number(rows[0]?.total_count ?? 0);
}

export async function fetchCanonicalProcoreProjectPayloads(companyId: string): Promise<unknown[]> {
  const rows = await prisma.$queryRawUnsafe<CanonicalProcoreProjectPayloadRow[]>(
    `
    WITH ranked AS (
      SELECT
        COALESCE(s.procore_project_id, s.external_id) AS canonical_project_id,
        s.payload,
        s.synced_at,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(s.procore_project_id, s.external_id)
          ORDER BY s.synced_at DESC
        ) AS rn
      FROM procore_project_staging s
      WHERE s.source = 'procore_v1_projects'
        AND ($1 = '' OR s.company_id = $1)
        AND COALESCE(s.procore_project_id, s.external_id) IS NOT NULL
    )
    SELECT canonical_project_id, payload, synced_at
    FROM ranked
    WHERE rn = 1
    ORDER BY synced_at DESC
    `,
    companyId
  );

  return rows.map((row) => row.payload);
}

export async function fetchCanonicalProcoreProjectPayloadById(companyId: string, projectId: string): Promise<unknown | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ payload: unknown }>>(
    `
    SELECT s.payload
    FROM procore_project_staging s
    WHERE s.source = 'procore_v1_projects'
      AND ($1 = '' OR s.company_id = $1)
      AND (
        COALESCE(s.procore_project_id, s.external_id) = $2
        OR s.external_id = $2
        OR COALESCE(s.procore_project_id, '') = $2
        OR COALESCE(s.project_id, '') = $2
      )
    ORDER BY s.synced_at DESC
    LIMIT 1
    `,
    companyId,
    projectId
  );

  return rows[0]?.payload ?? null;
}
