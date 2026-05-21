import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RelationRow = {
  purchaseorderlineitemcontractdetailrelation: string | null;
  purchaseordercontractrelation: string | null;
  commitmentchangeorderlineitemrelation: string | null;
  commitmentchangeorderrelation: string | null;
  commitmentcontractrelation: string | null;
  projectstagingrelation: string | null;
  bidboardrelation: string | null;
};

type CommitmentLineRow = {
  id: string;
  source_type: string;
  company_id: string | null;
  procore_project_id: string | null;
  project_name: string | null;
  customer: string | null;
  project_status: string | null;
  bid_board_status: string | null;
  vendor_name: string | null;
  parent_record_id: string | null;
  parent_procore_id: string | null;
  parent_number: string | null;
  parent_title: string | null;
  parent_status: string | null;
  parent_value: number | null;
  line_procore_id: string | null;
  description: string | null;
  quantity: number | null;
  unit_cost: number | null;
  total_amount: number | null;
  uom: string | null;
  position: number | null;
  wbs_code: string | null;
  cost_code: string | null;
  cost_type: string | null;
  synced_at: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get("pageSize") || "10000", 10) || 10000;
    const pageSize = Math.min(10000, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const companyId = String(searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || "").trim();
    const projectId = String(searchParams.get("projectId") || "").trim();
    const sourceType = String(searchParams.get("sourceType") || "").trim().toLowerCase();
    const projectStatus = String(searchParams.get("projectStatus") || "").trim().toLowerCase();
    const bidBoardStatus = String(searchParams.get("bidBoardStatus") || "").trim().toLowerCase();
    const parentStatus = String(searchParams.get("parentStatus") || "").trim().toLowerCase();
    const vendor = String(searchParams.get("vendor") || "").trim().toLowerCase();
    const search = String(searchParams.get("search") || "").trim().toLowerCase();

    const relationRows = await prisma.$queryRawUnsafe<RelationRow[]>(`
      SELECT
        to_regclass('public."PurchaseOrderLineItemContractDetail"')::text AS purchaseOrderLineItemContractDetailRelation,
        to_regclass('public."PurchaseOrderContract"')::text AS purchaseOrderContractRelation,
        to_regclass('public."CommitmentChangeOrderLineItem"')::text AS commitmentChangeOrderLineItemRelation,
        to_regclass('public."CommitmentChangeOrder"')::text AS commitmentChangeOrderRelation,
        to_regclass('public."CommitmentContract"')::text AS commitmentContractRelation,
        to_regclass('public.procore_project_staging')::text AS projectStagingRelation,
        to_regclass('public.procore_bid_board_live')::text AS bidBoardRelation
    `);

    const relations = relationRows[0] || {
      purchaseorderlineitemcontractdetailrelation: null,
      purchaseordercontractrelation: null,
      commitmentchangeorderlineitemrelation: null,
      commitmentchangeorderrelation: null,
      commitmentcontractrelation: null,
      projectstagingrelation: null,
      bidboardrelation: null,
    };

    const hasPurchaseOrderLineItems = Boolean(relations.purchaseorderlineitemcontractdetailrelation);
    const hasPurchaseOrderContracts = Boolean(relations.purchaseordercontractrelation);
    const hasCommitmentChangeOrderLineItems = Boolean(relations.commitmentchangeorderlineitemrelation);
    const hasCommitmentChangeOrders = Boolean(relations.commitmentchangeorderrelation);
    const hasCommitmentContracts = Boolean(relations.commitmentcontractrelation);
    const hasProjectStaging = Boolean(relations.projectstagingrelation);
    const hasBidBoard = Boolean(relations.bidboardrelation);

    const values: unknown[] = [companyId];
    const whereParts: string[] = [];

    if (projectId) {
      values.push(projectId);
      whereParts.push(`COALESCE(procore_project_id, '') = $${values.length}`);
    }

    if (sourceType) {
      values.push(sourceType);
      whereParts.push(`LOWER(COALESCE(source_type, '')) = $${values.length}`);
    }

    if (projectStatus) {
      values.push(projectStatus);
      whereParts.push(`LOWER(COALESCE(project_status, '')) = $${values.length}`);
    }

    if (bidBoardStatus) {
      values.push(bidBoardStatus);
      whereParts.push(`LOWER(COALESCE(bid_board_status, '')) = $${values.length}`);
    }

    if (parentStatus) {
      values.push(parentStatus);
      whereParts.push(`LOWER(COALESCE(parent_status, '')) = $${values.length}`);
    }

    if (vendor) {
      values.push(`%${vendor}%`);
      whereParts.push(`LOWER(COALESCE(vendor_name, '')) LIKE $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      whereParts.push(`(
        LOWER(COALESCE(project_name, '')) LIKE $${idx}
        OR LOWER(COALESCE(customer, '')) LIKE $${idx}
        OR LOWER(COALESCE(vendor_name, '')) LIKE $${idx}
        OR LOWER(COALESCE(parent_number, '')) LIKE $${idx}
        OR LOWER(COALESCE(parent_title, '')) LIKE $${idx}
        OR LOWER(COALESCE(description, '')) LIKE $${idx}
        OR LOWER(COALESCE(cost_code, '')) LIKE $${idx}
        OR LOWER(COALESCE(cost_type, '')) LIKE $${idx}
        OR LOWER(COALESCE(uom, '')) LIKE $${idx}
      )`);
    }

    const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

    const projectStagingCte = hasProjectStaging
      ? `
          project_staging_latest AS (
            SELECT DISTINCT ON (COALESCE(s.procore_project_id, s.external_id))
              COALESCE(s.procore_project_id, s.external_id) AS canonical_project_id,
              s.name AS project_name,
              s.customer,
              s.status AS project_status,
              s.synced_at
            FROM procore_project_staging s
            WHERE s.source = 'procore_v1_projects'
              AND s.company_id = $1
              AND COALESCE(s.procore_project_id, s.external_id) IS NOT NULL
            ORDER BY COALESCE(s.procore_project_id, s.external_id), s.synced_at DESC
          ),
        `
      : `
          project_staging_latest AS (
            SELECT
              NULL::text AS canonical_project_id,
              NULL::text AS project_name,
              NULL::text AS customer,
              NULL::text AS project_status,
              NULL::timestamptz AS synced_at
            WHERE FALSE
          ),
        `;

    const bidBoardCte = hasBidBoard
      ? `
          bid_board_latest AS (
            SELECT DISTINCT ON (b.procore_project_id)
              b.procore_project_id,
              b.status AS bid_board_status,
              b.synced_at
            FROM procore_bid_board_live b
            WHERE b.company_id = $1
              AND b.procore_project_id IS NOT NULL
            ORDER BY b.procore_project_id, b.synced_at DESC
          ),
        `
      : `
          bid_board_latest AS (
            SELECT
              NULL::text AS procore_project_id,
              NULL::text AS bid_board_status,
              NULL::timestamptz AS synced_at
            WHERE FALSE
          ),
        `;

    const purchaseOrderLinesCte =
      hasPurchaseOrderLineItems && hasPurchaseOrderContracts
        ? `
            purchase_order_lines AS (
              SELECT
                li.id,
                'purchase_order_line'::text AS source_type,
                COALESCE(li."procoreCompanyId", po."procoreCompanyId", $1)::text AS company_id,
                COALESCE(li."procoreProjectId", po."procoreProjectId") AS procore_project_id,
                st.project_name,
                st.customer,
                st.project_status,
                bb.bid_board_status,
                po."vendorName" AS vendor_name,
                po.id AS parent_record_id,
                po."procoreId" AS parent_procore_id,
                po.number AS parent_number,
                po.title AS parent_title,
                po.status AS parent_status,
                po.value::float AS parent_value,
                li."procoreId" AS line_procore_id,
                li.description,
                li.quantity::float AS quantity,
                li."unitCost"::float AS unit_cost,
                li."totalAmount"::float AS total_amount,
                li.uom,
                li.position,
                li."wbsCode" AS wbs_code,
                li."costCode" AS cost_code,
                li."costType" AS cost_type,
                COALESCE(li."procoreUpdatedAt", li."updatedAt", po."procoreUpdatedAt", po."updatedAt")::text AS synced_at
              FROM "PurchaseOrderLineItemContractDetail" li
              JOIN "PurchaseOrderContract" po
                ON po.id = li."purchaseOrderContractId"
              LEFT JOIN project_staging_latest st
                ON st.canonical_project_id = COALESCE(li."procoreProjectId", po."procoreProjectId")
              LEFT JOIN bid_board_latest bb
                ON bb.procore_project_id = COALESCE(li."procoreProjectId", po."procoreProjectId")
              WHERE COALESCE(li."procoreCompanyId", po."procoreCompanyId", $1)::text = $1
            ),
          `
        : `
            purchase_order_lines AS (
              SELECT
                NULL::text AS id,
                NULL::text AS source_type,
                NULL::text AS company_id,
                NULL::text AS procore_project_id,
                NULL::text AS project_name,
                NULL::text AS customer,
                NULL::text AS project_status,
                NULL::text AS bid_board_status,
                NULL::text AS vendor_name,
                NULL::text AS parent_record_id,
                NULL::text AS parent_procore_id,
                NULL::text AS parent_number,
                NULL::text AS parent_title,
                NULL::text AS parent_status,
                NULL::float AS parent_value,
                NULL::text AS line_procore_id,
                NULL::text AS description,
                NULL::float AS quantity,
                NULL::float AS unit_cost,
                NULL::float AS total_amount,
                NULL::text AS uom,
                NULL::int AS position,
                NULL::text AS wbs_code,
                NULL::text AS cost_code,
                NULL::text AS cost_type,
                NULL::text AS synced_at
              WHERE FALSE
            ),
          `;

    const commitmentChangeOrderVendorExpr = [
      hasCommitmentContracts ? `cc."vendorName"` : null,
      hasPurchaseOrderContracts ? `po."vendorName"` : null,
    ]
      .filter(Boolean)
      .join(", ");

    const commitmentChangeOrderLinesCte =
      hasCommitmentChangeOrderLineItems && hasCommitmentChangeOrders
        ? `
            commitment_change_order_lines AS (
              SELECT
                li.id,
                'commitment_change_order_line'::text AS source_type,
                COALESCE(li."procoreCompanyId", cco."procoreCompanyId", $1)::text AS company_id,
                COALESCE(li."procoreProjectId", cco."procoreProjectId") AS procore_project_id,
                st.project_name,
                st.customer,
                st.project_status,
                bb.bid_board_status,
                ${
                  commitmentChangeOrderVendorExpr
                    ? `COALESCE(${commitmentChangeOrderVendorExpr})`
                    : `NULL::text`
                } AS vendor_name,
                cco.id AS parent_record_id,
                cco."procoreId" AS parent_procore_id,
                cco.number AS parent_number,
                cco.title AS parent_title,
                cco.status AS parent_status,
                cco.value::float AS parent_value,
                li."procoreId" AS line_procore_id,
                li.description,
                li.quantity::float AS quantity,
                li."unitCost"::float AS unit_cost,
                li."totalAmount"::float AS total_amount,
                li.uom,
                li.position,
                li."wbsCode" AS wbs_code,
                li."costCode" AS cost_code,
                li."costType" AS cost_type,
                COALESCE(li."procoreUpdatedAt", li."updatedAt", cco."procoreUpdatedAt", cco."updatedAt")::text AS synced_at
              FROM "CommitmentChangeOrderLineItem" li
              JOIN "CommitmentChangeOrder" cco
                ON cco.id = li."changeOrderId"
              ${
                hasCommitmentContracts
                  ? `LEFT JOIN "CommitmentContract" cc
                ON cc."procoreId" = cco."procoreContractId"
                AND cc."procoreProjectId" = COALESCE(li."procoreProjectId", cco."procoreProjectId")`
                  : ""
              }
              ${
                hasPurchaseOrderContracts
                  ? `LEFT JOIN "PurchaseOrderContract" po
                ON po."procoreId" = cco."procoreContractId"
                AND po."procoreProjectId" = COALESCE(li."procoreProjectId", cco."procoreProjectId")`
                  : ""
              }
              LEFT JOIN project_staging_latest st
                ON st.canonical_project_id = COALESCE(li."procoreProjectId", cco."procoreProjectId")
              LEFT JOIN bid_board_latest bb
                ON bb.procore_project_id = COALESCE(li."procoreProjectId", cco."procoreProjectId")
              WHERE COALESCE(li."procoreCompanyId", cco."procoreCompanyId", $1)::text = $1
            ),
          `
        : `
            commitment_change_order_lines AS (
              SELECT
                NULL::text AS id,
                NULL::text AS source_type,
                NULL::text AS company_id,
                NULL::text AS procore_project_id,
                NULL::text AS project_name,
                NULL::text AS customer,
                NULL::text AS project_status,
                NULL::text AS bid_board_status,
                NULL::text AS vendor_name,
                NULL::text AS parent_record_id,
                NULL::text AS parent_procore_id,
                NULL::text AS parent_number,
                NULL::text AS parent_title,
                NULL::text AS parent_status,
                NULL::float AS parent_value,
                NULL::text AS line_procore_id,
                NULL::text AS description,
                NULL::float AS quantity,
                NULL::float AS unit_cost,
                NULL::float AS total_amount,
                NULL::text AS uom,
                NULL::int AS position,
                NULL::text AS wbs_code,
                NULL::text AS cost_code,
                NULL::text AS cost_type,
                NULL::text AS synced_at
              WHERE FALSE
            ),
          `;

    const baseCte = `
      WITH
      ${projectStagingCte}
      ${bidBoardCte}
      ${purchaseOrderLinesCte}
      ${commitmentChangeOrderLinesCte}
      base AS (
        SELECT * FROM purchase_order_lines
        UNION ALL
        SELECT * FROM commitment_change_order_lines
      )
    `;

    const rows = await prisma.$queryRawUnsafe<CommitmentLineRow[]>(
      `
        ${baseCte}
        SELECT *
        FROM base
        ${whereClause}
        ORDER BY
          COALESCE(project_status, '') ASC,
          COALESCE(project_name, '') ASC,
          COALESCE(source_type, '') ASC,
          COALESCE(vendor_name, '') ASC,
          COALESCE(parent_number, '') ASC,
          COALESCE(position, 0) ASC,
          id ASC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      `,
      ...values,
      pageSize,
      skip
    );

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number | string | bigint }>>(
      `
        ${baseCte}
        SELECT COUNT(*)::int AS total
        FROM base
        ${whereClause}
      `,
      ...values
    );

    const total = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: skip + rows.length < total,
      hasPreviousPage: page > 1,
      sources: {
        purchaseOrderLineItems: hasPurchaseOrderLineItems,
        purchaseOrderContracts: hasPurchaseOrderContracts,
        commitmentChangeOrderLineItems: hasCommitmentChangeOrderLineItems,
        commitmentChangeOrders: hasCommitmentChangeOrders,
        commitmentContracts: hasCommitmentContracts,
      },
      data: rows.map((row) => ({
        id: row.id,
        sourceType: row.source_type,
        companyId: row.company_id,
        procoreProjectId: row.procore_project_id,
        projectName: row.project_name,
        customer: row.customer,
        projectStatus: row.project_status,
        bidBoardStatus: row.bid_board_status,
        vendorName: row.vendor_name,
        parentRecordId: row.parent_record_id,
        parentProcoreId: row.parent_procore_id,
        parentNumber: row.parent_number,
        parentTitle: row.parent_title,
        parentStatus: row.parent_status,
        parentValue: row.parent_value,
        lineProcoreId: row.line_procore_id,
        description: row.description,
        quantity: row.quantity,
        unitCost: row.unit_cost,
        totalAmount: row.total_amount,
        uom: row.uom,
        position: row.position,
        wbsCode: row.wbs_code,
        costCode: row.cost_code,
        costType: row.cost_type,
        syncedAt: row.synced_at,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to fetch row-level commitments:", message);
    return NextResponse.json(
      { success: false, error: "Failed to fetch row-level commitments", details: message },
      { status: 500 }
    );
  }
}
