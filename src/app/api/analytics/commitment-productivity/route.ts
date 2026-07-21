import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type DbValue = bigint | number | string | Date | null;
type DbRow = Record<string, DbValue>;

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function GET(request: NextRequest) {
  try {
    const companyId = String(
      request.nextUrl.searchParams.get('companyId') || process.env.PROCORE_COMPANY_ID || ''
    ).trim();
    const projectId = String(request.nextUrl.searchParams.get('projectId') || '').trim() || null;

    if (!companyId) {
      return NextResponse.json({ success: false, error: 'Missing companyId.' }, { status: 400 });
    }

    const [rows, actualSummaryRows] = await Promise.all([
      prisma.$queryRawUnsafe<DbRow[]>(
        `
          WITH alias_counts AS (
            SELECT
              company_id,
              procore_project_id,
              target_line_item_id,
              COUNT(*)::bigint AS alias_count,
              COUNT(*) FILTER (WHERE confidence < 1)::bigint AS reviewed_alias_count
            FROM analytics_po_line_aliases
            WHERE company_id = $1
              AND ($2::text IS NULL OR procore_project_id = $2)
            GROUP BY company_id, procore_project_id, target_line_item_id
          )
          SELECT
            v.company_id,
            v.project_id,
            pp.project_number,
            pp.project_name,
            pp.customer,
            pp.status AS project_status,
            v.contract_id,
            v.po_number,
            v.po_title,
            v.po_status,
            v.vendor_name,
            v.line_item_id,
            v.position,
            v.description,
            v.cost_code,
            v.cost_type,
            v.wbs_code,
            v.uom,
            v.expected_quantity,
            v.used_quantity,
            v.delivered_quantity,
            v.remaining_quantity,
            v.quantity_complete_ratio,
            v.productivity_log_count,
            v.first_activity_date,
            v.last_activity_date,
            COALESCE(a.alias_count, 0) AS alias_count,
            COALESCE(a.reviewed_alias_count, 0) AS reviewed_alias_count
          FROM analytics_po_line_productivity_v v
          LEFT JOIN pmc_projects pp
            ON pp.company_id = v.company_id
           AND pp.procore_project_id = v.project_id
          LEFT JOIN alias_counts a
            ON a.company_id = v.company_id
           AND a.procore_project_id = v.project_id
           AND a.target_line_item_id = v.line_item_id
          WHERE v.company_id = $1
            AND ($2::text IS NULL OR v.project_id = $2)
          ORDER BY
            COALESCE(pp.project_name, v.project_id),
            COALESCE(v.po_number, v.contract_id),
            v.position NULLS LAST,
            v.line_item_id
        `,
        companyId,
        projectId
      ),
      prisma.$queryRawUnsafe<DbRow[]>(
        `
          WITH productivity AS (
            SELECT
              p."procoreProjectId" AS project_id,
              p."lineItemId" AS source_line_item_id,
              COALESCE(a.target_line_item_id, p."lineItemId") AS canonical_line_item_id
            FROM "ProductivityLog" p
            LEFT JOIN analytics_po_line_aliases a
              ON a.company_id = p."procoreCompanyId"
             AND a.procore_project_id = p."procoreProjectId"
             AND a.source_line_item_id = p."lineItemId"
            WHERE p."procoreCompanyId" = $1
              AND ($2::text IS NULL OR p."procoreProjectId" = $2)
          )
          SELECT
            COUNT(*)::bigint AS productivity_count,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1
                FROM "PurchaseOrderLineItemContractDetail" li
                WHERE li."procoreCompanyId" = $1
                  AND li."procoreProjectId" = productivity.project_id
                  AND li."procoreId" = productivity.canonical_line_item_id
              )
            )::bigint AS matched_count,
            COUNT(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1
                FROM "PurchaseOrderLineItemContractDetail" li
                WHERE li."procoreCompanyId" = $1
                  AND li."procoreProjectId" = productivity.project_id
                  AND li."procoreId" = productivity.canonical_line_item_id
              )
            )::bigint AS unmatched_count,
            COUNT(DISTINCT source_line_item_id)::bigint AS source_line_count
          FROM productivity
        `,
        companyId,
        projectId
      ),
    ]);

    const lines = rows.map((row) => ({
      companyId: String(row.company_id),
      projectId: String(row.project_id),
      projectNumber: toText(row.project_number),
      projectName: toText(row.project_name) || String(row.project_id),
      customer: toText(row.customer),
      projectStatus: toText(row.project_status),
      contractId: toText(row.contract_id),
      poNumber: toText(row.po_number),
      poTitle: toText(row.po_title),
      poStatus: toText(row.po_status),
      vendorName: toText(row.vendor_name),
      lineItemId: String(row.line_item_id),
      position: row.position === null ? null : toNumber(row.position),
      description: toText(row.description),
      costCode: toText(row.cost_code),
      costType: toText(row.cost_type),
      wbsCode: toText(row.wbs_code),
      uom: toText(row.uom),
      expectedQuantity: toNumber(row.expected_quantity),
      usedQuantity: toNumber(row.used_quantity),
      deliveredQuantity: toNumber(row.delivered_quantity),
      remainingQuantity: toNumber(row.remaining_quantity),
      quantityCompleteRatio:
        row.quantity_complete_ratio === null ? null : toNumber(row.quantity_complete_ratio),
      productivityLogCount: toNumber(row.productivity_log_count),
      firstActivityDate: toIso(row.first_activity_date),
      lastActivityDate: toIso(row.last_activity_date),
      aliasCount: toNumber(row.alias_count),
      reviewedAliasCount: toNumber(row.reviewed_alias_count),
    }));

    const actualSummary = actualSummaryRows[0] ?? {};
    const productivityCount = toNumber(actualSummary.productivity_count);
    const matchedCount = toNumber(actualSummary.matched_count);

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      generatedAt: new Date().toISOString(),
      summary: {
        projectCount: new Set(lines.map((line) => line.projectId)).size,
        poCount: new Set(lines.map((line) => `${line.projectId}:${line.contractId}`)).size,
        lineCount: lines.length,
        activeLineCount: lines.filter((line) => line.productivityLogCount > 0).length,
        productivityCount,
        matchedProductivityCount: matchedCount,
        unmatchedProductivityCount: toNumber(actualSummary.unmatched_count),
        productivityMatchRate: productivityCount > 0 ? matchedCount / productivityCount : 1,
        sourceLineCount: toNumber(actualSummary.source_line_count),
        aliasCount: lines.reduce((sum, line) => sum + line.aliasCount, 0),
        reviewedAliasCount: lines.reduce((sum, line) => sum + line.reviewedAliasCount, 0),
      },
      lines,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: 'Failed to load commitment productivity analytics.', details: message },
      { status: 500 }
    );
  }
}
