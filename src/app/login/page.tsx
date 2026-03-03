"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function LoginContent() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string>("/wip");
  const [framed, setFramed] = useState(false);

  const navigateToLogin = () => {
    const loginUrl = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

    router.push(loginUrl);
  };

  useEffect(() => {
    // Check URL for error parameter
    const searchParams = new URLSearchParams(window.location.search);
    const errorParam = searchParams.get('error');
    const returnToParam = searchParams.get('returnTo');
    if (returnToParam) setReturnTo(returnToParam);

    let isFramed = false;
    try {
      isFramed = window.self !== window.top;
    } catch {
      isFramed = true;
    }
    setFramed(isFramed);

    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      return;
    }

    // Auto-redirect to login in normal browser context (old behavior)
    if (isFramed) {
      return;
    }

    const timer = setTimeout(() => {
      const loginUrl = `/api/auth/login?returnTo=${encodeURIComponent(returnToParam || '/wip')}`;
      router.replace(loginUrl);
    }, 100);

    return () => clearTimeout(timer);
  }, [router]);

  const handleManualLogin = () => {
    navigateToLogin();
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
        ) : framed ? (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-amber-800 text-sm font-medium">Login in embedded mode</p>
            <p className="text-amber-700 text-xs mt-2">
              Your browser is inside an embedded frame. If login does not open automatically, use the button below.
            </p>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-700 text-sm">Redirecting to login...</p>
          </div>
        )}

        {framed ? (
          <a
            href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200"
          >
            Open Login in New Tab
          </a>
        ) : (
          <button
            onClick={handleManualLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200"
          >
            Continue to Login
          </button>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginContent />;
}
