"use client";

import { useEffect } from "react";

export default function AuthCompletePage() {
  const procoreAppUrl = "https://us02.procore.com/598134325658789/company/apps/598134325530275";

  useEffect(() => {
    // If this tab was script-opened for auth, try to close it first.
    try {
      window.close();
    } catch {
      // Ignore and fall through to redirect.
    }

    // Fallback for browsers that block window.close.
    const timer = window.setTimeout(() => {
      window.location.replace(procoreAppUrl);
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
