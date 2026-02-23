"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function LoginContent() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check URL for error parameter
    const searchParams = new URLSearchParams(window.location.search);
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      return;
    }

    // Auto-redirect to Auth0 login
    const timer = setTimeout(() => {
      router.replace("/api/auth/login?returnTo=/wip");
    }, 100);

    return () => clearTimeout(timer);
  }, [router]);

  const handleManualLogin = () => {
    router.push("/api/auth/login?returnTo=/wip");
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
            <p className="text-blue-700 text-sm">Redirecting to login...</p>
          </div>
        )}

        <button
          onClick={handleManualLogin}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors duration-200"
        >
          Continue to Login
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <LoginContent />;
}
