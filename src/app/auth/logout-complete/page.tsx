"use client";

import { useEffect } from "react";

const AUTH_LOGOUT_SIGNAL_KEY = "analytics-auth-logout";
const AUTH_LOGOUT_SIGNAL_CHANNEL = "analytics-auth-logout";
const AUTH_LOGOUT_CONTEXT_KEY = "analytics-auth-logout-context";

export default function LogoutCompletePage() {
  const procoreAppUrl = "https://us02.procore.com/598134325658789/company/apps/598134325530275";

  useEffect(() => {
    let source: "embedded" | "app" = "app";
    let appReturnTo = "/";

    try {
      const raw = localStorage.getItem(AUTH_LOGOUT_CONTEXT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { source?: string; returnTo?: string };
        source = parsed.source === "embedded" ? "embedded" : "app";
        appReturnTo = parsed.returnTo && parsed.returnTo.startsWith("/") ? parsed.returnTo : "/";
      }
      localStorage.removeItem(AUTH_LOGOUT_CONTEXT_KEY);
    } catch {
      // Ignore malformed context.
    }

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

    const timer = window.setTimeout(() => {
      if (source === "embedded") {
        try {
          window.close();
          return;
        } catch {
          // Ignore close failures and use fallback redirect.
        }
        window.location.replace(procoreAppUrl);
        return;
      }

      window.location.replace(`/login?returnTo=${encodeURIComponent(appReturnTo)}`);
    }, 300);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Signed out</h1>
        <p style={{ color: "#4b5563", marginBottom: 16 }}>
          Finishing sign-out. You can close this tab if it does not close automatically.
        </p>
        <a href="/login" style={{ color: "#15616D", fontWeight: 700, textDecoration: "underline" }}>
          Return to sign in
        </a>
      </div>
    </div>
  );
}
