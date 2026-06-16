"use client";

import { useEffect } from "react";

const AUTH_SIGNAL_KEY = "analytics-auth-complete";
const AUTH_SIGNAL_CHANNEL = "analytics-auth";
const DEFAULT_PROCORE_COMPANY_ID = "598134325805519";
const DEFAULT_PROCORE_APP_ID = "598134325538667";

function getProcoreAppUrl() {
  const companyId = process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID || DEFAULT_PROCORE_COMPANY_ID;
  const appId = process.env.NEXT_PUBLIC_PROCORE_APP_ID || DEFAULT_PROCORE_APP_ID;
  return `https://us02.procore.com/${companyId}/company/apps/${appId}`;
}

export default function AuthCompletePage() {
  const procoreAppUrl = getProcoreAppUrl();

  const resolveFallbackUrl = () => {
    if (typeof window === "undefined") return procoreAppUrl;

    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo");
    const fallback = params.get("fallback");

    if (fallback === "procore-app") {
      return procoreAppUrl;
    }

    if (
      returnTo &&
      returnTo.startsWith("/") &&
      !returnTo.startsWith("/api/auth") &&
      !returnTo.startsWith("/auth/complete")
    ) {
      return returnTo;
    }

    return procoreAppUrl;
  };

  useEffect(() => {
    try {
      localStorage.setItem(AUTH_SIGNAL_KEY, String(Date.now()));
    } catch {
      // Ignore localStorage failures.
    }

    try {
      const channel = new BroadcastChannel(AUTH_SIGNAL_CHANNEL);
      channel.postMessage(AUTH_SIGNAL_KEY);
      channel.close();
    } catch {
      // Ignore BroadcastChannel failures.
    }

    // If this tab was script-opened for auth, try to close it first.
    try {
      window.close();
    } catch {
      // Ignore and fall through to redirect.
    }

    // Fallback for browsers that block window.close.
    const fallbackUrl = resolveFallbackUrl();
    const timer = window.setTimeout(() => {
      window.location.replace(fallbackUrl);
    }, 300);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Sign-in complete</h1>
        <p style={{ color: "#4b5563", marginBottom: 16 }}>
          Returning you to Procore. You can close this tab if it does not close automatically.
        </p>
        <a href={procoreAppUrl} style={{ color: "#15616D", fontWeight: 700, textDecoration: "underline" }}>
          Back to Procore app
        </a>
      </div>
    </div>
  );
}
