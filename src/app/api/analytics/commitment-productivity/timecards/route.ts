import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type DbValue = bigint | number | string | boolean | Date | null;
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
    const projectId = String(request.nextUrl.searchParams.get('projectId') || '').trim();
    const scopeCode = String(request.nextUrl.searchParams.get('scopeCode') || '').trim().toUpperCase();

    if (!companyId || !projectId || !scopeCode) {
      return NextResponse.json(
        { success: false, error: 'companyId, projectId, and scopeCode are required.' },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRawUnsafe<DbRow[]>(
      `
        WITH timecards AS (
          SELECT
            t.*,
            UPPER(COALESCE(NULLIF(BTRIM(t."costCodeFullCode"), ''), '(UNASSIGNED)')) AS scope_code,
            COALESCE(
              NULLIF(BTRIM(t."costCodeName"), ''),
              NULLIF(BTRIM(t.description), ''),
              NULLIF(BTRIM(t."costCodeFullCode"), ''),
              'Uncategorized Labor'
            ) AS labor_description
          FROM "TimecardEntry" t
          WHERE t."procoreCompanyId" = $1
            AND t."procoreProjectId" = $2
            AND t."procoreDeletedAt" IS NULL
        ),
        labor_logs AS (
        SELECT
          id,
          "procoreId" AS procore_id,
          date,
          COALESCE(hours, "totalHoursWorked", 0)::double precision AS hours,
          COALESCE(NULLIF(BTRIM("partyName"), ''), NULLIF(BTRIM(party), '')) AS employee_name,
          labor_description,
          NULLIF(BTRIM("costCodeFullCode"), '') AS cost_code,
          NULLIF(BTRIM(description), '') AS notes,
          NULLIF(BTRIM("timecardTimeTypeName"), '') AS time_type,
          NULLIF(BTRIM(status), '') AS status,
          NULLIF(BTRIM("timeIn"), '') AS time_in,
          NULLIF(BTRIM("timeOut"), '') AS time_out,
          "lunchTime" AS lunch_time,
          NULLIF(BTRIM("createdByName"), '') AS created_by_name,
          NULLIF(BTRIM("subJobName"), '') AS sub_job_name,
          billable,
          'timecard'::text AS source
        FROM timecards
        WHERE scope_code = $3

        UNION ALL

        SELECT
          'admin-pm-' || c.id::text AS id,
          NULL::text AS procore_id,
          c.accounting_date::timestamp AS date,
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
          )::double precision AS hours,
          'PM Productivity Closeout'::text AS employee_name,
          'Project Management'::text AS labor_description,
          '01-300-10-20'::text AS cost_code,
          c.notes_marker AS notes,
          'Procore Productivity Adjustment'::text AS time_type,
          c.status,
          NULL::text AS time_in,
          NULL::text AS time_out,
          NULL::double precision AS lunch_time,
          'PMC Analytics'::text AS created_by_name,
          NULL::text AS sub_job_name,
          NULL::boolean AS billable,
          'productivity_closeout'::text AS source
        FROM forms_productivity_closeouts c
        WHERE c.company_id = $1
          AND c.procore_project_id = $2
          AND $3 = '01-300-10-20'
          AND c.kind = 'project_management_closeout'
          AND c.status IN ('created', 'detected_existing')
          AND c.procore_log_id IS NOT NULL
        )
        SELECT *
        FROM labor_logs
        ORDER BY date DESC, employee_name NULLS LAST, procore_id NULLS LAST, id
      `,
      companyId,
      projectId,
      scopeCode
    );

    const entries = rows.map((row) => ({
      id: String(row.id),
      procoreId: toText(row.procore_id),
      date: toIso(row.date),
      hours: toNumber(row.hours),
      employeeName: toText(row.employee_name),
      laborDescription: toText(row.labor_description) || 'Uncategorized Labor',
      costCode: toText(row.cost_code),
      notes: toText(row.notes),
      timeType: toText(row.time_type),
      status: toText(row.status),
      timeIn: toText(row.time_in),
      timeOut: toText(row.time_out),
      lunchTime: row.lunch_time === null ? null : toNumber(row.lunch_time),
      createdByName: toText(row.created_by_name),
      subJobName: toText(row.sub_job_name),
      billable: typeof row.billable === 'boolean' ? row.billable : null,
      source: toText(row.source) || 'timecard',
    }));

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      scopeCode,
      summary: {
        entryCount: entries.length,
        totalHours: entries.reduce((sum, entry) => sum + entry.hours, 0),
      },
      entries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: 'Failed to load labor timecard entries.', details: message },
      { status: 500 }
    );
  }
}
