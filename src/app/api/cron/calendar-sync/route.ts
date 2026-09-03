import { NextRequest, NextResponse } from "next/server";

import { hasValidProcoreSyncSecret } from "@/lib/procore";
import { calendarRepollMinutes, syncDueCalendars, syncUserCalendar } from "@/lib/msCalendarSync";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!hasValidProcoreSyncSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const requestedEmail = String(body.email || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(25, Number.parseInt(String(body.limit || "5"), 10) || 5));

  if (requestedEmail) {
    const result = await syncUserCalendar(requestedEmail);
    return NextResponse.json({
      success: result.outcome !== "error",
      scanned: 1,
      synced: result.outcome === "synced" ? 1 : 0,
      accessDenied: result.outcome === "access_denied" ? 1 : 0,
      failed: result.outcome === "error" ? 1 : 0,
      nextBatch: false,
      results: [result],
    }, { status: result.outcome === "error" ? 207 : 200 });
  }

  const result = await syncDueCalendars({ limit });
  return NextResponse.json({
    success: result.failed === 0,
    configured: result.configured,
    repollMinutes: calendarRepollMinutes(),
    ...result,
  }, { status: result.failed === 0 ? 200 : 207 });
}
