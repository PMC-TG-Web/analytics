'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

export default function DebugCookies() {
  const { user, loading: authLoading } = useAuth();
  const [cookies, setCookies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCookies = async () => {
      try {
        const response = await fetch('/api/debug/cookies', { credentials: 'include' });
        const data = await response.json();
        setCookies(data.cookies || {});
      } catch (err) {
        console.error('Failed to fetch cookies:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCookies();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">🔍 Debug Cookies</h1>

        <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">Authentication Status</h2>
          {authLoading ? (
            <p className="text-gray-400">Loading auth...</p>
          ) : user ? (
            <>
              <p className="text-green-400 font-semibold mb-2">✓ Authenticated</p>
              <p className="text-gray-300">Email: <span className="text-blue-400">{user.email}</span></p>
            </>
          ) : (
            <p className="text-red-400">✗ Not authenticated</p>
          )}
        </div>

        <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">Available Cookies</h2>
          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : Object.keys(cookies).length === 0 ? (
            <p className="text-red-400">❌ No cookies found!</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(cookies).map(([key, value]) => (
                <div key={key} className="bg-slate-600/30 rounded p-3 border border-slate-600">
                  <p className="text-gray-400 text-sm">{key}</p>
                  <p className="text-green-400 font-mono text-xs break-all">
                    {value.substring(0, 100)}{value.length > 100 ? '...' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600 mb-6">
          <h2 className="text-xl font-bold text-white mb-4">What You Need</h2>
          <div className="space-y-3 text-gray-300 text-sm">
            <div className="flex items-start gap-3">
              <span className="text-blue-400">✓</span>
              <span><strong>auth_session</strong> - For app authentication (you have this)</span>
            </div>
            <div className="flex items-start gap-3">
              <span className={user ? 'text-blue-400' : 'text-red-400'}>
                {cookies['procore_access_token'] ? '✓' : '✗'}
              </span>
              <span><strong>procore_access_token</strong> - For Procore API access (needed for dashboard)</span>
            </div>
          </div>
        </div>

        <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600">
          <h2 className="text-xl font-bold text-white mb-4">How to Get Procore Token</h2>
          <div className="space-y-3">
            <div>
              <p className="text-gray-300 font-semibold mb-2">Option 1: Login with Procore</p>
              <a 
                href="/api/auth/procore/login?returnTo=/debug-cookies"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded transition-colors"
              >
                Authenticate with Procore
              </a>
            </div>
            <div>
              <p className="text-gray-300 font-semibold mb-2">Option 2: Use Dev Login</p>
              <p className="text-gray-400 text-sm mb-2">Add to <code className="bg-slate-800 px-2 py-1 rounded">.env.local</code>:</p>
              <code className="block bg-slate-800 p-3 rounded text-green-400 text-xs mb-2">
                PROCORE_ACCESS_TOKEN=your_token_here
              </code>
              <a 
                href="/dev-login?returnTo=/debug-cookies"
                className="inline-block bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 px-4 rounded transition-colors"
              >
                Dev Login
              </a>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <a 
            href="/"
            className="text-blue-400 hover:text-blue-300 text-sm"
          >
            ← Back to home
          </a>
        </div>
      </div>
    </div>
  );
}
