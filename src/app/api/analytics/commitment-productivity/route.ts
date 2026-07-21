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

    const [rows, actualSummaryRows, laborRows] = await Promise.all([
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
      prisma.$queryRawUnsafe<DbRow[]>(
        `
          WITH budget AS (
            SELECT
              b.company_id,
              b.project_id,
              UPPER(REGEXP_REPLACE(BTRIM(b.cost_code), '\\.L$', '', 'i')) AS scope_code,
              MAX(
                NULLIF(
                  BTRIM(REGEXP_REPLACE(COALESCE(b.cost_code_description, ''), '\\.Labor$', '', 'i')),
                  ''
                )
              ) AS labor_description,
              SUM(COALESCE(b.quantity, 0))::double precision AS original_expected_hours
            FROM budgetlineitems b
            WHERE b.company_id = $1
              AND ($2::text IS NULL OR b.project_id = $2)
              AND b.cost_code ~* '\\.L$'
            GROUP BY
              b.company_id,
              b.project_id,
              UPPER(REGEXP_REPLACE(BTRIM(b.cost_code), '\\.L$', '', 'i'))
          ),
          approved_change_orders AS (
            SELECT
              c.company_id,
              c.project_id,
              UPPER(
                COALESCE(
                  NULLIF(REGEXP_REPLACE(BTRIM(c.cost_code), '\\.L$', '', 'i'), ''),
                  NULLIF(REGEXP_REPLACE(BTRIM(c.wbs_code), '\\.L$', '', 'i'), ''),
                  '(UNASSIGNED)'
                )
              ) AS scope_code,
              SUM(COALESCE(c.labor_hours, 0))::double precision AS approved_change_hours
            FROM procore_change_order_package_lines c
            WHERE c.company_id = $1
              AND ($2::text IS NULL OR c.project_id = $2)
              AND LOWER(COALESCE(c.package_status, '')) IN ('approved', 'executed', 'complete', 'completed')
              AND c.labor_hours IS NOT NULL
            GROUP BY
              c.company_id,
              c.project_id,
              UPPER(
                COALESCE(
                  NULLIF(REGEXP_REPLACE(BTRIM(c.cost_code), '\\.L$', '', 'i'), ''),
                  NULLIF(REGEXP_REPLACE(BTRIM(c.wbs_code), '\\.L$', '', 'i'), ''),
                  '(UNASSIGNED)'
                )
              )
          ),
          actual_entries AS (
            SELECT
              t."procoreCompanyId" AS company_id,
              t."procoreProjectId" AS project_id,
              UPPER(COALESCE(NULLIF(BTRIM(t."costCodeFullCode"), ''), '(UNASSIGNED)')) AS scope_code,
              COALESCE(
                NULLIF(BTRIM(t."costCodeName"), ''),
                NULLIF(BTRIM(t.description), ''),
                NULLIF(BTRIM(t."costCodeFullCode"), ''),
                'Uncategorized Labor'
              ) AS labor_description,
              NULLIF(BTRIM(t."costCodeId"), '') AS cost_code_id,
              COALESCE(t.hours, t."totalHoursWorked", 0)::double precision AS actual_hours,
              1::bigint AS entry_count,
              t.date AS entry_date
            FROM "TimecardEntry" t
            WHERE t."procoreCompanyId" = $1
              AND ($2::text IS NULL OR t."procoreProjectId" = $2)
              AND t."procoreProjectId" IS NOT NULL
              AND t."procoreDeletedAt" IS NULL

            UNION ALL

            SELECT
              c.company_id,
              c.procore_project_id AS project_id,
              '01-300-10-20' AS scope_code,
              'Project Management' AS labor_description,
              NULL::text AS cost_code_id,
              LEAST(
                c.adjustment_quantity,
                GREATEST(
                  c.expected_quantity - COALESCE((
                    SELECT SUM(COALESCE(t2.hours, t2."totalHoursWorked", 0))
                    FROM "TimecardEntry" t2
                    WHERE t2."procoreCompanyId" = c.company_id
                      AND t2."procoreProjectId" = c.procore_project_id
                      AND UPPER(BTRIM(COALESCE(t2."costCodeFullCode", ''))) = '01-300-10-20'
                      AND t2."procoreDeletedAt" IS NULL
                  ), 0),
                  0
                )
              )::double precision AS actual_hours,
              1::bigint AS entry_count,
              c.accounting_date::timestamp AS entry_date
            FROM forms_productivity_closeouts c
            WHERE c.company_id = $1
              AND ($2::text IS NULL OR c.procore_project_id = $2)
              AND c.kind = 'project_management_closeout'
              AND c.status IN ('created', 'detected_existing')
              AND c.procore_log_id IS NOT NULL
          ),
          actual AS (
            SELECT
              company_id,
              project_id,
              scope_code,
              MAX(labor_description) AS labor_description,
              MAX(cost_code_id) AS cost_code_id,
              SUM(actual_hours)::double precision AS actual_hours,
              SUM(entry_count)::bigint AS entry_count,
              MIN(entry_date) AS first_entry_date,
              MAX(entry_date) AS last_entry_date
            FROM actual_entries
            GROUP BY
              company_id,
              project_id,
              scope_code
          ),
          scope_keys AS (
            SELECT company_id, project_id, scope_code FROM budget
            UNION
            SELECT company_id, project_id, scope_code FROM approved_change_orders
            UNION
            SELECT company_id, project_id, scope_code FROM actual
          )
          SELECT
            k.company_id,
            k.project_id,
            'code:' || k.scope_code AS labor_group_key,
            k.scope_code,
            COALESCE(a.labor_description, b.labor_description, k.scope_code) AS labor_description,
            a.cost_code_id,
            COALESCE(b.original_expected_hours, 0)::double precision AS original_expected_hours,
            COALESCE(c.approved_change_hours, 0)::double precision AS approved_change_hours,
            (COALESCE(b.original_expected_hours, 0) + COALESCE(c.approved_change_hours, 0))::double precision AS expected_hours,
            COALESCE(a.actual_hours, 0)::double precision AS actual_hours,
            (COALESCE(b.original_expected_hours, 0) + COALESCE(c.approved_change_hours, 0) - COALESCE(a.actual_hours, 0))::double precision AS remaining_hours,
            CASE
              WHEN COALESCE(b.original_expected_hours, 0) + COALESCE(c.approved_change_hours, 0) = 0 THEN NULL
              ELSE COALESCE(a.actual_hours, 0) /
                (COALESCE(b.original_expected_hours, 0) + COALESCE(c.approved_change_hours, 0))
            END::double precision AS labor_burn_ratio,
            COALESCE(a.entry_count, 0)::bigint AS entry_count,
            a.first_entry_date,
            a.last_entry_date
          FROM scope_keys k
          LEFT JOIN budget b USING (company_id, project_id, scope_code)
          LEFT JOIN approved_change_orders c USING (company_id, project_id, scope_code)
          LEFT JOIN actual a USING (company_id, project_id, scope_code)
          ORDER BY k.project_id, labor_description, k.scope_code
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
    const laborGroups = laborRows.map((row) => ({
      companyId: String(row.company_id),
      projectId: String(row.project_id),
      key: String(row.labor_group_key),
      scopeCode: String(row.scope_code),
      description: toText(row.labor_description) || 'Uncategorized Labor',
      costCodeId: toText(row.cost_code_id),
      costCode: String(row.scope_code) === '(UNASSIGNED)' ? null : String(row.scope_code),
      originalExpectedHours: toNumber(row.original_expected_hours),
      approvedChangeHours: toNumber(row.approved_change_hours),
      expectedHours: toNumber(row.expected_hours),
      totalHours: toNumber(row.actual_hours),
      remainingHours: toNumber(row.remaining_hours),
      laborBurnRatio: row.labor_burn_ratio === null ? null : toNumber(row.labor_burn_ratio),
      entryCount: toNumber(row.entry_count),
      firstEntryDate: toIso(row.first_entry_date),
      lastEntryDate: toIso(row.last_entry_date),
    }));

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
        timecardEntryCount: laborGroups.reduce((sum, group) => sum + group.entryCount, 0),
        timecardHours: laborGroups.reduce((sum, group) => sum + group.totalHours, 0),
        expectedLaborHours: laborGroups.reduce((sum, group) => sum + group.expectedHours, 0),
        laborProjectCount: new Set(
          laborGroups.filter((group) => group.entryCount > 0).map((group) => group.projectId)
        ).size,
      },
      lines,
      laborGroups,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: 'Failed to load commitment productivity analytics.', details: message },
      { status: 500 }
    );
  }
}
