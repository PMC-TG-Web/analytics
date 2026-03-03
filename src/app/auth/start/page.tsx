"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function AuthStartPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const returnTo = searchParams.get("returnTo") || "/";
    const loginPath = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

    if (window.top && window.top !== window) {
      window.top.location.href = loginPath;
      return;
    }

    window.location.href = loginPath;
  }, [searchParams]);

  return (
    <div style={{ padding: 24, fontFamily: "Inter, Arial, sans-serif", color: "#1f2937" }}>
      Redirecting to sign in...
    </div>
  );
}
