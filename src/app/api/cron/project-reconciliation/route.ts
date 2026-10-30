import { NextRequest, NextResponse } from "next/server";
import { getRequiredSyncSecret } from "@/lib/cronSync";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

// Acceptance is not completion: only the background runner writes the health log.
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const secret = getRequiredSyncSecret();
  if (!secret) return NextResponse.json({ success: false, error: "PROCORE_SYNC_SECRET is not configured" }, { status: 503 });
  try {
    const response = await fetch(`${request.nextUrl.origin}/api/background/project-reconciliation`, {
      method: "POST", headers: { "content-type": "application/json", "x-sync-secret": secret },
      body: "{}", signal: AbortSignal.timeout(10_000),
    });
    const accepted = response.status === 202;
    return NextResponse.json({ success: accepted, accepted, completed: false }, {
      status: accepted ? 202 : 502, headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ success: false, accepted: false, completed: false, error: "Project reconciliation dispatch failed" }, { status: 502 });
  }
}
