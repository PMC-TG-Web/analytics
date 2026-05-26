import { NextRequest, NextResponse } from "next/server";
import { getRequiredSyncSecret, parsePositiveInt, runProcoreCronSync } from "@/lib/cronSync";

/**
 * POST /api/cron/sync
 *
 * Runs the Procore data sync to completion and records the result in sync_logs.
 * Netlify scheduled runs should dispatch the background function instead of
 * calling this route directly, so long-running work is not done after a response.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SINGLE_ALLOWED_PROCORE_COMPANY_ID = '598134325805519';

export async function POST(request: NextRequest) {
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return NextResponse.json(
      {
        error: "CRON_SECRET is not configured",
        details: "Set CRON_SECRET before enabling scheduled sync.",
      },
      { status: 503 }
    );
  }

  const provided = request.headers.get("x-cron-secret")?.trim();
  if (provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncSecret = getRequiredSyncSecret();
  if (!syncSecret) {
    return NextResponse.json(
      {
        error: "PROCORE_SYNC_SECRET is not configured",
        details: "Set PROCORE_SYNC_SECRET before enabling scheduled sync workers.",
      },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const maxProjectsInput = body?.maxProjects ?? request.nextUrl.searchParams.get("maxProjects");
  const lookbackDaysInput = body?.lookbackDays ?? request.nextUrl.searchParams.get("lookbackDays");
  const requestedCompanyId = String(
    body?.companyId || request.nextUrl.searchParams.get("companyId") || ""
  ).trim();
  if (requestedCompanyId && requestedCompanyId !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
    return NextResponse.json(
      { error: 'Forbidden company context for this deployment.' },
      { status: 403 }
    );
  }
  const companyId = requestedCompanyId || SINGLE_ALLOWED_PROCORE_COMPANY_ID;
  const triggeredByInput = body?.triggeredBy ?? request.nextUrl.searchParams.get("triggeredBy");
  const triggeredBy: string = triggeredByInput === "manual" ? "manual" : "cron";
  const maxProjects = maxProjectsInput === undefined || maxProjectsInput === null
    ? undefined
    : Math.max(1, parsePositiveInt(String(maxProjectsInput), 25));
  const lookbackDays = lookbackDaysInput === undefined || lookbackDaysInput === null
    ? undefined
    : Math.max(7, parsePositiveInt(String(lookbackDaysInput), 30));

  if (!companyId) {
    return NextResponse.json(
      { error: "MISSING_COMPANY_ID: company context is not configured." },
      { status: 400 }
    );
  }

  const result = await runProcoreCronSync({
    origin: request.nextUrl.origin,
    companyId,
    syncSecret,
    triggeredBy,
    maxProjects,
    lookbackDays,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 207 });
}
