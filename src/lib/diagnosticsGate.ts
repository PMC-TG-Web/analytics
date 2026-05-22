import { NextResponse } from "next/server";

export const DIAGNOSTICS_OR_TEST_API_ROUTES = [
  "/api/procore/test",
  "/api/procore/test/bidform-patch",
  "/api/procore/diagnostics/bid-board-status-check",
  "/api/procore/diagnostics/project-coverage",
  "/api/procore/diagnostics/user-access",
  "/api/gantt-v2/debug-sync",
  "/api/scheduling/diagnostics",
  "/api/scheduling/debug-data",
] as const;

export const DIAGNOSTICS_OR_TEST_PAGE_ROUTES = [
  "/auth0-test",
  "/procore/test",
  "/debug-cookies",
  "/dev-login",
  "/diagnostics",
  "/test-schedules",
] as const;

export function areProductionDiagnosticsEnabled(): boolean {
  return String(process.env.ENABLE_PROD_DIAGNOSTICS || "").toLowerCase() === "true";
}

export function shouldBlockDiagnosticsInProduction(): boolean {
  return process.env.NODE_ENV === "production" && !areProductionDiagnosticsEnabled();
}

export function matchesDiagnosticsOrTestRoute(
  pathname: string,
  routes: readonly string[]
): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Blocks diagnostics/test endpoints in production by default.
 * Set ENABLE_PROD_DIAGNOSTICS=true only for controlled emergency debugging.
 */
export function denyDiagnosticsInProduction(): NextResponse | null {
  if (shouldBlockDiagnosticsInProduction()) {
    return NextResponse.json(
      { success: false, error: "Not found" },
      { status: 404 }
    );
  }

  return null;
}
