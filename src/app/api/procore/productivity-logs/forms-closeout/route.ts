import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  FORMS_CLOSEOUT_MARKER,
  FORMS_COST_CODES,
  classifyFormsCloseoutLine,
  formsCloseoutMarker,
  hasFormsCloseoutMarker,
} from "@/lib/formsProductivityCloseout";
import {
  getClientCredentialsToken,
  makeRequest,
  procoreConfig,
  withProcoreLiveApiBypassForAuthenticatedSession,
} from "@/lib/procore";
import { persistProductivityLogs, type ProcoreLog } from "@/lib/procoreProductivity";

export const dynamic = "force-dynamic";

type DbValue = bigint | number | string | Date | boolean | null;
type DbRow = Record<string, DbValue>;
type UnknownRecord = Record<string, unknown>;

const TOLERANCE = 0.005;

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function validAccountingDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function lineItemIdFromLog(log: UnknownRecord): string {
  const direct = String(log.line_item_id ?? "").trim();
  if (direct) return direct;
  const lineItem = isRecord(log.line_item) ? log.line_item : null;
  return String(lineItem?.id ?? "").trim();
}

function quantityUsedFromLog(log: UnknownRecord): number {
  return toNumber(log.quantity_used ?? log.quantityUsed);
}

function notesFromLog(log: UnknownRecord): string {
  return String(log.notes ?? "").trim();
}

async function loadPreview(companyId: string, projectId: string | null) {
  const rows = await prisma.$queryRawUnsafe<DbRow[]>(
    `
      SELECT
        v.company_id,
        v.project_id,
        p.project_number,
        COALESCE(p.project_name, v.project_id) AS project_name,
        v.contract_id,
        v.po_number,
        v.po_title,
        v.po_status,
        v.vendor_name,
        v.line_item_id,
        v.position,
        v.description,
        v.cost_code,
        v.uom,
        v.expected_quantity,
        v.used_quantity,
        v.productivity_log_count,
        c.status AS closeout_status,
        c.procore_log_id,
        c.expected_quantity AS closeout_expected_quantity,
        c.adjustment_quantity AS closeout_adjustment_quantity,
        c.accounting_date AS closeout_accounting_date,
        c.error AS closeout_error
      FROM analytics_po_line_productivity_v v
      LEFT JOIN pmc_projects p
        ON p.company_id = v.company_id
       AND p.procore_project_id = v.project_id
      LEFT JOIN forms_productivity_closeouts c
        ON c.company_id = v.company_id
       AND c.procore_project_id = v.project_id
       AND c.line_item_id = v.line_item_id
       AND c.kind = 'forms_closeout'
      WHERE v.company_id = $1
        AND ($2::text IS NULL OR v.project_id = $2)
        AND COALESCE(v.expected_quantity, 0) > 0
        AND (
          REGEXP_REPLACE(UPPER(BTRIM(COALESCE(v.cost_code, ''))), '\\.(L|M|S|O)$', '', 'i') = ANY($3::text[])
          OR COALESCE(v.description, '') ILIKE '%form%'
        )
      ORDER BY COALESCE(p.project_name, v.project_id), COALESCE(v.po_number, v.contract_id), v.position NULLS LAST
    `,
    companyId,
    projectId,
    [...FORMS_COST_CODES]
  );

  const lines = rows.map((row) => {
    const seeded = ["created", "detected_existing"].includes(String(row.closeout_status || ""));
    const classification = classifyFormsCloseoutLine({
      poStatus: toText(row.po_status),
      costCode: toText(row.cost_code),
      description: toText(row.description),
      uom: toText(row.uom),
      expectedQuantity: toNumber(row.expected_quantity),
      usedQuantity: toNumber(row.used_quantity),
      seeded,
    });

    return {
      companyId: String(row.company_id),
      projectId: String(row.project_id),
      projectNumber: toText(row.project_number),
      projectName: String(row.project_name),
      contractId: toText(row.contract_id),
      poNumber: toText(row.po_number),
      poTitle: toText(row.po_title),
      poStatus: toText(row.po_status),
      vendorName: toText(row.vendor_name),
      lineItemId: String(row.line_item_id),
      position: row.position === null ? null : toNumber(row.position),
      description: toText(row.description),
      costCode: toText(row.cost_code),
      uom: toText(row.uom),
      expectedQuantity: toNumber(row.expected_quantity),
      usedQuantity: toNumber(row.used_quantity),
      proposedQuantity: roundQuantity(Math.max(0, classification.remainingQuantity)),
      productivityLogCount: toNumber(row.productivity_log_count),
      disposition: classification.disposition,
      reason: classification.reason,
      closeout: row.closeout_status ? {
        status: String(row.closeout_status),
        procoreLogId: toText(row.procore_log_id),
        expectedQuantity: toNumber(row.closeout_expected_quantity),
        adjustmentQuantity: toNumber(row.closeout_adjustment_quantity),
        accountingDate: row.closeout_accounting_date instanceof Date
          ? row.closeout_accounting_date.toISOString().slice(0, 10)
          : toText(row.closeout_accounting_date),
        error: toText(row.closeout_error),
      } : null,
    };
  });

  return lines;
}

function summarize(lines: Awaited<ReturnType<typeof loadPreview>>) {
  return {
    projectCount: new Set(lines.map((line) => line.projectId)).size,
    lineCount: lines.length,
    readyCount: lines.filter((line) => line.disposition === "ready").length,
    reviewCount: lines.filter((line) => line.disposition === "review").length,
    completeCount: lines.filter((line) => line.disposition === "complete").length,
    seededCount: lines.filter((line) => line.disposition === "seeded").length,
    proposedQuantity: roundQuantity(lines
      .filter((line) => line.disposition === "ready")
      .reduce((sum, line) => sum + line.proposedQuantity, 0)),
  };
}

async function fetchAllLiveLogs(accessToken: string, companyId: string, projectId: string) {
  const logs: UnknownRecord[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await makeRequest(
      `/rest/v1.0/projects/${encodeURIComponent(projectId)}/productivity_logs?page=${page}&per_page=100`,
      accessToken,
      undefined,
      companyId
    );
    const pageLogs = Array.isArray(response) ? response.filter(isRecord) : [];
    logs.push(...pageLogs);
    if (pageLogs.length < 100) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return logs;
}

function liveStateByLine(logs: UnknownRecord[]) {
  const state = new Map<string, { used: number; markerLog: UnknownRecord | null }>();
  for (const log of logs) {
    const lineItemId = lineItemIdFromLog(log);
    if (!lineItemId) continue;
    const current = state.get(lineItemId) || { used: 0, markerLog: null };
    current.used += quantityUsedFromLog(log);
    if (hasFormsCloseoutMarker(notesFromLog(log))) current.markerLog = log;
    state.set(lineItemId, current);
  }
  return state;
}

async function recordCloseout(params: {
  companyId: string;
  projectId: string;
  lineItemId: string;
  expectedQuantity: number;
  usedBefore: number;
  adjustmentQuantity: number;
  uom: string | null;
  accountingDate: string;
  status: string;
  procoreLogId?: string | null;
  error?: string | null;
  payload?: unknown;
}) {
  const marker = formsCloseoutMarker(params.lineItemId);
  await prisma.formsProductivityCloseout.upsert({
    where: {
      companyId_procoreProjectId_lineItemId_kind: {
        companyId: params.companyId,
        procoreProjectId: params.projectId,
        lineItemId: params.lineItemId,
        kind: "forms_closeout",
      },
    },
    create: {
      companyId: params.companyId,
      procoreProjectId: params.projectId,
      lineItemId: params.lineItemId,
      kind: "forms_closeout",
      expectedQuantity: params.expectedQuantity,
      usedBefore: params.usedBefore,
      adjustmentQuantity: params.adjustmentQuantity,
      uom: params.uom,
      accountingDate: new Date(`${params.accountingDate}T00:00:00.000Z`),
      status: params.status,
      procoreLogId: params.procoreLogId || null,
      notesMarker: marker,
      error: params.error || null,
      payload: params.payload === undefined ? undefined : asJson(params.payload),
    },
    update: {
      expectedQuantity: params.expectedQuantity,
      usedBefore: params.usedBefore,
      adjustmentQuantity: params.adjustmentQuantity,
      uom: params.uom,
      accountingDate: new Date(`${params.accountingDate}T00:00:00.000Z`),
      status: params.status,
      procoreLogId: params.procoreLogId || null,
      notesMarker: marker,
      error: params.error || null,
      payload: params.payload === undefined ? undefined : asJson(params.payload),
    },
  });
}

async function claimCloseout(params: {
  companyId: string;
  projectId: string;
  lineItemId: string;
  expectedQuantity: number;
  usedBefore: number;
  adjustmentQuantity: number;
  uom: string | null;
  accountingDate: string;
}) {
  const claimed = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(
    `
      INSERT INTO forms_productivity_closeouts (
        company_id, procore_project_id, line_item_id, kind,
        expected_quantity, used_before, adjustment_quantity, uom,
        accounting_date, status, notes_marker, created_at, updated_at
      ) VALUES ($1, $2, $3, 'forms_closeout', $4, $5, $6, $7, $8::date, 'creating', $9, NOW(), NOW())
      ON CONFLICT (company_id, procore_project_id, line_item_id, kind)
      DO UPDATE SET
        expected_quantity = EXCLUDED.expected_quantity,
        used_before = EXCLUDED.used_before,
        adjustment_quantity = EXCLUDED.adjustment_quantity,
        uom = EXCLUDED.uom,
        accounting_date = EXCLUDED.accounting_date,
        status = 'creating',
        error = NULL,
        updated_at = NOW()
      WHERE forms_productivity_closeouts.status = 'failed'
         OR (
           forms_productivity_closeouts.status = 'creating'
           AND forms_productivity_closeouts.updated_at < NOW() - INTERVAL '15 minutes'
         )
      RETURNING id
    `,
    params.companyId,
    params.projectId,
    params.lineItemId,
    params.expectedQuantity,
    params.usedBefore,
    params.adjustmentQuantity,
    params.uom,
    params.accountingDate,
    formsCloseoutMarker(params.lineItemId)
  );
  return claimed.length > 0;
}

export async function GET(request: NextRequest) {
  try {
    const companyId = String(request.nextUrl.searchParams.get("companyId") || procoreConfig.companyId || "").trim();
    const projectId = String(request.nextUrl.searchParams.get("projectId") || "").trim() || null;
    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }
    const lines = await loadPreview(companyId, projectId);
    return NextResponse.json({ success: true, generatedAt: new Date().toISOString(), summary: summarize(lines), lines });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: "Failed to preview forms closeout.", details: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return withProcoreLiveApiBypassForAuthenticatedSession(request, async () => {
    try {
      const body = (await request.json().catch(() => ({}))) as UnknownRecord;
      const cookieStore = await cookies();
      const companyId = String(body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || "").trim();
      const projectId = String(body.projectId || "").trim();
      const accountingDate = validAccountingDate(body.accountingDate);
      const selectedLineItemIds = Array.isArray(body.lineItemIds)
        ? new Set(body.lineItemIds.map((value) => String(value).trim()).filter(Boolean))
        : null;

      if (!companyId || !projectId || !accountingDate) {
        return NextResponse.json(
          { success: false, error: "companyId, projectId, and a valid accountingDate are required." },
          { status: 400 }
        );
      }

      const preview = await loadPreview(companyId, projectId);
      const candidates = preview.filter((line) =>
        line.disposition === "ready" && (!selectedLineItemIds || selectedLineItemIds.has(line.lineItemId))
      );
      if (candidates.length === 0) {
        return NextResponse.json({ success: true, projectId, accountingDate, createdCount: 0, skippedCount: 0, failedCount: 0, results: [] });
      }

      const cookieToken = String(cookieStore.get("procore_access_token")?.value || "").trim();
      const accessToken = cookieToken || await getClientCredentialsToken();
      const liveLogs = await fetchAllLiveLogs(accessToken, companyId, projectId);
      const liveState = liveStateByLine(liveLogs);
      const results: Array<Record<string, unknown>> = [];

      for (const line of candidates) {
        const state = liveState.get(line.lineItemId) || { used: 0, markerLog: null };
        const liveUsed = roundQuantity(state.used);
        const adjustment = roundQuantity(line.expectedQuantity - liveUsed);
        const marker = formsCloseoutMarker(line.lineItemId);

        if (state.markerLog) {
          const procoreLogId = String(state.markerLog.id ?? "").trim() || null;
          await recordCloseout({
            companyId, projectId, lineItemId: line.lineItemId, expectedQuantity: line.expectedQuantity,
            usedBefore: liveUsed, adjustmentQuantity: 0, uom: line.uom, accountingDate,
            status: "detected_existing", procoreLogId, payload: state.markerLog,
          });
          results.push({ lineItemId: line.lineItemId, status: "skipped", reason: "Existing marked closeout log found in Procore.", procoreLogId });
          continue;
        }

        if (adjustment <= TOLERANCE) {
          results.push({ lineItemId: line.lineItemId, status: "skipped", reason: "Live Procore quantity already meets or exceeds expected.", liveUsed });
          continue;
        }

        const claimed = await claimCloseout({
          companyId,
          projectId,
          lineItemId: line.lineItemId,
          expectedQuantity: line.expectedQuantity,
          usedBefore: liveUsed,
          adjustmentQuantity: adjustment,
          uom: line.uom,
          accountingDate,
        });
        if (!claimed) {
          results.push({ lineItemId: line.lineItemId, status: "skipped", reason: "This line is already being processed or has been recorded." });
          continue;
        }

        const notes = `${marker} Administrative forms quantity adjustment. Expected ${roundQuantity(line.expectedQuantity)} ${line.uom || ""}; existing used ${liveUsed}; adjustment ${adjustment}.`;
        const payload = {
          date: accountingDate,
          line_item_id: Number(line.lineItemId),
          notes,
          quantity_delivered: 0,
          quantity_used: adjustment,
        };

        try {
          const created = await makeRequest(
            `/rest/v1.0/projects/${encodeURIComponent(projectId)}/productivity_logs`,
            accessToken,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productivity_log: payload }) },
            companyId
          );
          const createdRecord = isRecord(created) ? created : {};
          const procoreLogId = String(createdRecord.id ?? "").trim() || null;
          await recordCloseout({
            companyId, projectId, lineItemId: line.lineItemId, expectedQuantity: line.expectedQuantity,
            usedBefore: liveUsed, adjustmentQuantity: adjustment, uom: line.uom, accountingDate,
            status: "created", procoreLogId, payload: created,
          });
          if (isRecord(created) && createdRecord.id) {
            await persistProductivityLogs([created as ProcoreLog], {
              companyId, projectId, projectName: line.projectName, projectNumber: line.projectNumber || undefined,
              createProjectIfMissing: false,
            });
          }
          state.used = liveUsed + adjustment;
          state.markerLog = createdRecord;
          liveState.set(line.lineItemId, state);
          results.push({ lineItemId: line.lineItemId, status: "created", adjustmentQuantity: adjustment, procoreLogId });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await recordCloseout({
            companyId, projectId, lineItemId: line.lineItemId, expectedQuantity: line.expectedQuantity,
            usedBefore: liveUsed, adjustmentQuantity: adjustment, uom: line.uom, accountingDate,
            status: "failed", error: message, payload,
          });
          results.push({ lineItemId: line.lineItemId, status: "failed", error: message });
          if (/\b429\b/.test(message)) break;
        }

        await new Promise((resolve) => setTimeout(resolve, 350));
      }

      return NextResponse.json({
        success: true,
        projectId,
        accountingDate,
        marker: FORMS_CLOSEOUT_MARKER,
        createdCount: results.filter((result) => result.status === "created").length,
        skippedCount: results.filter((result) => result.status === "skipped").length,
        failedCount: results.filter((result) => result.status === "failed").length,
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ success: false, error: "Failed to run forms closeout.", details: message }, { status: 500 });
    }
  });
}
