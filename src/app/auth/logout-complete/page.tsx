"use client";

import { useEffect } from "react";

const AUTH_LOGOUT_SIGNAL_KEY = "analytics-auth-logout";
const AUTH_LOGOUT_SIGNAL_CHANNEL = "analytics-auth-logout";

export default function LogoutCompletePage() {
  const procoreAppUrl = "https://us02.procore.com/598134325658789/company/apps/598134325530275";

  useEffect(() => {
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

    try {
      window.close();
    } catch {
      // Ignore close failures and use fallback redirect.
    }

    const timer = window.setTimeout(() => {
      window.location.replace(procoreAppUrl);
    }, 400);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, Arial, sans-serif" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Signed out</h1>
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
