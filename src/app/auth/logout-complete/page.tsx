"use client";

import { useEffect, useMemo, useState } from "react";

const AUTH_LOGOUT_SIGNAL_KEY = "analytics-auth-logout";
const AUTH_LOGOUT_SIGNAL_CHANNEL = "analytics-auth-logout";
const AUTH_LOGOUT_CONTEXT_KEY = "analytics-auth-logout-context";
const DEFAULT_PROCORE_COMPANY_ID = "598134325805519";
const DEFAULT_PROCORE_APP_ID = "598134325538667";

function getProcoreAppUrl() {
  const companyId = process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || DEFAULT_PROCORE_COMPANY_ID;
  const appId = process.env.NEXT_PUBLIC_PROCORE_APP_ID || DEFAULT_PROCORE_APP_ID;
  return `https://us02.procore.com/${companyId}/company/apps/${appId}`;
}

export default function LogoutCompletePage() {
  const procoreAppUrl = getProcoreAppUrl();
  const [source, setSource] = useState<"embedded" | "app">("app");
  const [appReturnTo, setAppReturnTo] = useState("/");

  const loginHref = useMemo(
    () => `/login?returnTo=${encodeURIComponent(appReturnTo || "/")}`,
    [appReturnTo]
  );

  useEffect(() => {
    let resolvedSource: "embedded" | "app" = "app";
    let resolvedReturnTo = "/";

    try {
      const raw = localStorage.getItem(AUTH_LOGOUT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { source?: string; returnTo?: string };
        resolvedSource = parsed.source === "embedded" ? "embedded" : "app";
        resolvedReturnTo = parsed.returnTo && parsed.returnTo.startsWith("/") ? parsed.returnTo : "/";
      }
      localStorage.removeItem(AUTH_LOGOUT_CONTEXT_KEY);
    } catch {
      // Ignore malformed context.
    }

    setSource(resolvedSource);
    setAppReturnTo(resolvedReturnTo);

    try {
      localStorage.setItem(AUTH_LOGOUT_SIGNAL_KEY, String(Date.now()));
    } catch {
      // Ignore localStorage failures.
    }

    try {
      const channel = new BroadcastChannel(AUTH_LOGOUT_SIGNAL_CHANNEL);
      channel.postMessage(AUTH_LOGOUT_SIGNAL_KEY);
      channel.close();
    } catch {
      // Ignore BroadcastChannel failures.
    }
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Successfully signed out</h1>
        <p style={{ color: "#4b5563", marginBottom: 16 }}>
          You are now logged out. Choose where you want to go next.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <a href={loginHref} style={{ color: "#15616D", fontWeight: 700, textDecoration: "underline" }}>
            Sign in again
          </a>
          {source === "embedded" ? (
            <a href={procoreAppUrl} style={{ color: "#374151", fontWeight: 600, textDecoration: "underline" }}>
              Back to Procore
            </a>
          ) : (
            <a href={appReturnTo || "/"} style={{ color: "#374151", fontWeight: 600, textDecoration: "underline" }}>
              Return to app
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
