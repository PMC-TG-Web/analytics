import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type DbValue = bigint | number | string | Date | boolean | null;
type DbRow = Record<string, DbValue>;

function toNumber(value: unknown): number {
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
      request.nextUrl.searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || ""
    ).trim();
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim();
    const lineItemIds = [
      ...new Set(
        String(request.nextUrl.searchParams.get("lineItemIds") || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      ),
    ].slice(0, 500);

    if (!companyId || !projectId || lineItemIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "companyId, projectId, and lineItemIds are required." },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRawUnsafe<DbRow[]>(
      `
        WITH canonical_logs AS (
          SELECT
            p.*,
            COALESCE(a.target_line_item_id, p."lineItemId") AS canonical_line_item_id,
            (a.source_line_item_id IS NOT NULL) AS alias_applied
          FROM "ProductivityLog" p
          LEFT JOIN analytics_po_line_aliases a
            ON a.company_id = p."procoreCompanyId"
           AND a.procore_project_id = p."procoreProjectId"
           AND a.source_line_item_id = p."lineItemId"
          WHERE p."procoreCompanyId" = $1
            AND p."procoreProjectId" = $2
            AND p."procoreDeletedAt" IS NULL
            AND COALESCE(p."lineItemHolderTitle", '') NOT ILIKE '%Billing File%'
        )
        SELECT
          "procoreId" AS log_id,
          "procoreProjectId" AS project_id,
          "lineItemId" AS source_line_item_id,
          canonical_line_item_id,
          alias_applied,
          date,
          status,
          position,
          "lineItemHolderNumber" AS po_number,
          "lineItemHolderTitle" AS po_title,
          "lineItemDescription" AS line_description,
          "quantityUsed" AS quantity_used,
          "createdByName" AS created_by_name,
          foreman,
          crew,
          hours,
          notes
        FROM canonical_logs
        WHERE canonical_line_item_id = ANY($3::text[])
        ORDER BY date DESC, position NULLS LAST, "procoreId"
      `,
      companyId,
      projectId,
      lineItemIds
    );

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      count: rows.length,
      logs: rows.map((row) => ({
        logId: toText(row.log_id),
        projectId: String(row.project_id),
        sourceLineItemId: toText(row.source_line_item_id),
        lineItemId: String(row.canonical_line_item_id),
        aliasApplied: Boolean(row.alias_applied),
        date: toIso(row.date),
        status: toText(row.status),
        position: row.position === null ? null : toNumber(row.position),
        poNumber: toText(row.po_number),
        poTitle: toText(row.po_title),
        lineDescription: toText(row.line_description),
        quantityUsed: toNumber(row.quantity_used),
        createdByName: toText(row.created_by_name),
        foreman: toText(row.foreman),
        crew: toText(row.crew),
        hours: row.hours === null ? null : toNumber(row.hours),
        notes: toText(row.notes),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to load productivity log details.", details: message },
      { status: 500 }
    );
  }
}
