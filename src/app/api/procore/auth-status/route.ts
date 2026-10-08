import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";
import { APP_SESSION_COOKIE, procoreSignInEnabled } from '@/lib/appSignInPolicy';
import { appSessions } from '@/lib/appSession';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const appSession = procoreSignInEnabled() && cookieStore.has(APP_SESSION_COOKIE)
      ? await appSessions.resolve(cookieStore.get(APP_SESSION_COOKIE)?.value) : null;
    const accessToken = cookieStore.get("procore_access_token")?.value;
    const refreshToken = cookieStore.get("procore_refresh_token")?.value;
    const companyId = String(cookieStore.get("procore_company_id")?.value || "").trim();
    const scope = String(cookieStore.get("procore_scope")?.value || "").trim();
    const scopes = scope ? scope.split(/\s+/).filter(Boolean) : [];
    const normalizedScopes = scopes.map((entry) => entry.toLowerCase());
    const hasFullProcoreScope = normalizedScopes.includes("procore_all");
    let hasServiceToken = false;
    let serviceTokenError: string | null = null;

    if (!accessToken && !appSession && procoreConfig.clientId && procoreConfig.clientSecret) {
      try {
        await getClientCredentialsToken();
        hasServiceToken = true;
      } catch (error) {
        serviceTokenError = error instanceof Error ? error.message : String(error);
      }
    }

    return NextResponse.json({
      success: true,
      connected: !appSession?.needsReconnect && (Boolean(accessToken) || hasServiceToken),
      needsReconnect: appSession?.needsReconnect || false,
      authMode: accessToken ? "user_oauth" : hasServiceToken ? "client_credentials" : "none",
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: appSession ? !appSession.needsReconnect : Boolean(refreshToken),
      hasServiceToken,
      serviceTokenError,
      companyId: companyId || procoreConfig.companyId || null,
      scope: scope || null,
      scopes,
      hasReadScope: hasFullProcoreScope || normalizedScopes.includes("read"),
      hasWriteScope: hasFullProcoreScope || normalizedScopes.includes("write"),
      hasFullProcoreScope,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: "Failed to check Procore auth status",
        details: message,
      },
      { status: 500 }
    );
  }
}
