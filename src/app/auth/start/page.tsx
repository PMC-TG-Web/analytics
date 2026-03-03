"use client";

import { useEffect } from "react";

export default function AuthStartPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo") || "/";
    const loginPath = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

    try {
      if (window.top && window.top !== window) {
        try {
          window.top.location.assign(loginPath);
          return;
        } catch {
          // Some embedded/sandboxed contexts block top navigation.
          // Fall back to same-frame navigation.
        }
      }

      window.location.assign(loginPath);
    } catch {
      // Last-resort fallback if assign throws for any reason.
      window.location.href = loginPath;
    }
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "Inter, Arial, sans-serif", color: "#1f2937" }}>
      Redirecting to sign in...
    </div>
  );
}
