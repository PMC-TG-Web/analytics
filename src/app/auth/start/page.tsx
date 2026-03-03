"use client";

import { useEffect, useMemo, useState } from "react";

export default function AuthStartPage() {
  const [framed, setFramed] = useState(false);

  const loginPath = useMemo(() => {
    if (typeof window === "undefined") return "/api/auth/login";
    const params = new URLSearchParams(window.location.search);
    const returnTo = params.get("returnTo") || "/";
    return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  useEffect(() => {
    try {
      const isFramed = window.self !== window.top;
      setFramed(isFramed);

      if (!isFramed) {
        window.location.assign(loginPath);
      }
    } catch {
      // Cross-origin/sandboxed frame access can throw; treat as framed.
      setFramed(true);
    }
  }, [loginPath]);

  return (
    <div style={{ padding: 24, fontFamily: "Inter, Arial, sans-serif", color: "#1f2937" }}>
      {!framed ? (
        "Redirecting to sign in..."
      ) : (
        <div>
          <p style={{ marginBottom: 12 }}>
            Sign-in must be opened outside the embedded Procore frame.
          </p>
          <a
            href={loginPath}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#15616D", textDecoration: "underline", fontWeight: 600 }}
          >
            Open sign in in a new tab
          </a>
        </div>
      )}
    </div>
  );
}
