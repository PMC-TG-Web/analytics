"use client";

import { useEffect, useRef, useState } from "react";

function LoginContent() {
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string>("/");
  const [framed, setFramed] = useState(false);
  const [status, setStatus] = useState<string>("Choose a login method.");
  const pollRef = useRef<number | null>(null);

  const procoreAppUrl = "https://us02.procore.com/598134325658789/company/apps/598134325530275";

  const normalizeReturnTo = (value: string | null) => {
    const candidate = (value || "/").trim();
    if (!candidate.startsWith("/")) return "/";

    const lower = candidate.toLowerCase();
    if (lower.startsWith("/login") || lower.startsWith("/auth/start") || lower.startsWith("/api/auth/")) {
      return "/";
    }

    return candidate;
  };

  const navigateTop = (url: string) => {
    try {
      if (window.top) {
        window.top.location.href = url;
        return;
      }
    } catch {
      // Ignore and try fallback methods below.
    }

    const topNav = window.open(url, "_top");
    if (topNav) return;

    const newTab = window.open(url, "_blank", "noopener,noreferrer");
    if (newTab) return;

    window.location.assign(url);
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const errorParam = searchParams.get("error");
    const safeReturnTo = normalizeReturnTo(searchParams.get("returnTo"));

    setReturnTo(safeReturnTo);

    let isFramed = false;
    try {
      isFramed = window.self !== window.top;
    } catch {
      isFramed = true;
    }
    setFramed(isFramed);

    if (errorParam) {
      setError(decodeURIComponent(errorParam));
    } else if (isFramed) {
      // In Procore embed mode, wait for explicit user click to avoid redirect loops.
      setStatus("Click below to sign in.");
    }

    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redirectToProcoreApp = () => {
    navigateTop(procoreAppUrl);
  };

  const startAuthPolling = (popup: Window | null) => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }

    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (res.ok) {
          if (popup && !popup.closed) {
            popup.close();
          }
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (framed) {
            setStatus("Login successful. Reloading embedded app...");
            window.location.reload();
          } else {
            setStatus("Login successful. Opening Procore app...");
            redirectToProcoreApp();
          }
          return;
        }

        if (popup && popup.closed) {
          setStatus("Login window closed. Click a login button to try again.");
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // keep polling
      }
    }, 1000);
  };

  const openLoginPopup = () => {
    setError(null);
    setStatus("Waiting for login...");

    const loginUrl = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

    if (framed) {
      const framedReturnTo = "/auth/complete?source=procore";
      const framedLoginUrl = `/api/auth/login?returnTo=${encodeURIComponent(framedReturnTo)}`;
      const authTab = window.open(framedLoginUrl, "analytics_auth_tab");
      setStatus("Sign-in opened in a new tab. Complete login there and this app will continue automatically.");
      // Some browsers return a null handle for newly opened tabs even when the tab opens.
      // Start polling regardless so the embedded app can resume after authentication.
      startAuthPolling(authTab || null);
      return;
    }

    const popup = window.open(
      loginUrl,
      "analytics_auth",
      "popup=yes,width=520,height=760,left=200,top=80"
    );

    if (!popup) {
      setError("Popup blocked. Please allow popups and try again.");
      setStatus("Popup was blocked.");
      return;
    }

    startAuthPolling(popup);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-slate-800 p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-center text-slate-800 mb-8">Analytics</h1>

        {error ? (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700 text-sm font-medium">Error: {error}</p>
            <p className="text-red-600 text-xs mt-2">If this persists, contact your administrator.</p>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-700 text-sm">{status}</p>
            {framed && (
              <p className="text-blue-600 text-xs mt-2">
                You are in an embedded Procore frame, so login opens in the top window.
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={openLoginPopup}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200"
          >
            Login with Email
          </button>
          <button
            onClick={openLoginPopup}
            className="w-full bg-slate-600 hover:bg-slate-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200"
          >
            Login with Procore
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginContent />;
}
