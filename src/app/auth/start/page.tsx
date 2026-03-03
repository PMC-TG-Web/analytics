"use client";

import { useEffect } from "react";

export default function AuthStartPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo") || "/";
    const loginPath = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

    if (window.top && window.top !== window) {
      window.top.location.href = loginPath;
      return;
    }

    window.location.href = loginPath;
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "Inter, Arial, sans-serif", color: "#1f2937" }}>
      Redirecting to sign in...
    </div>
  );
}
