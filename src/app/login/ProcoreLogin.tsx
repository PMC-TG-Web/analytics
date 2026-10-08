'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { safeAppReturnTo } from '@/lib/appSignInPolicy';

export default function ProcoreLogin({ allowEmail }: { allowEmail: boolean }) {
  const [returnTo, setReturnTo] = useState('/');
  const [framed, setFramed] = useState(false);
  const [message, setMessage] = useState('Use your Procore account to open your pages.');
  const [busy, setBusy] = useState(false);
  const [openInTab, setOpenInTab] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const destination = safeAppReturnTo(params.get('returnTo'));
    setReturnTo(destination);
    try { setFramed(window.self !== window.top); } catch { setFramed(true); }
    const error = params.get('error');
    if (error) setMessage(error);
    let active = true;
    const check = async () => {
      try {
        const result = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!result.ok || !active) return false;
        // A previously authenticated but now forbidden destination must not create a login loop.
        let previous = 0;
        try { previous = Number(sessionStorage.getItem('analytics-procore-login-return') || 0); } catch { /* Storage can be blocked. */ }
        if (Date.now() - previous < 10_000) {
          setMessage('Sign-in succeeded, but that page could not be opened. Try Home or contact your administrator.');
          return true;
        }
        try {
          sessionStorage.setItem('analytics-procore-login-return', String(Date.now()));
          sessionStorage.removeItem('analytics-auth-user');
        } catch { /* Login does not depend on browser storage. */ }
        window.location.replace(destination);
        return true;
      } catch { return false; }
    };
    void check();
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data === 'analytics-auth-complete') void check();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'analytics-auth-complete') void check();
    };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('analytics-auth');
    if (channel) channel.onmessage = (event) => { if (event.data === 'analytics-auth-complete') void check(); };
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      if (timer.current) clearInterval(timer.current);
      channel?.close();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function signIn(provider: 'procore' | 'email') {
    const endpoint = provider === 'procore' ? '/api/auth/procore/login' : '/api/auth/login';
    const destination = framed ? `/auth/complete?returnTo=${encodeURIComponent(returnTo)}` : returnTo;
    const url = `${endpoint}?returnTo=${encodeURIComponent(destination)}`;
    try { sessionStorage.removeItem('analytics-procore-login-return'); } catch { /* Storage can be blocked. */ }
    if (!framed) {
      // OAuth is an external provider redirect, not an App Router navigation.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(url);
      return;
    }
    const popup = window.open(url, 'analytics_procore_signin');
    if (!popup) { setOpenInTab(true); setMessage('Open the app in a new tab to finish signing in.'); return; }
    setBusy(true);
    setMessage('Finish signing in in the new tab.');
    setOpenInTab(true);
    const started = Date.now();
    let checking = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(async () => {
      if (checking) return;
      if (Date.now() - started > 120_000) {
        if (timer.current) clearInterval(timer.current);
        setBusy(false);
        setMessage('If your browser blocks embedded sign-in, use Open app in a new tab.');
        return;
      }
      checking = true;
      try {
        const result = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (result.ok) {
          if (timer.current) clearInterval(timer.current);
          try { sessionStorage.removeItem('analytics-auth-user'); } catch { /* Storage can be blocked. */ }
          window.location.replace(returnTo);
        }
      } catch { /* Keep the explicit alternate-tab action available. */ }
      finally { checking = false; }
    }, 1500);
  }

  return <main className="flex min-h-screen items-center justify-center bg-slate-900 p-5">
    <section className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-xl">
      <h1 className="text-3xl font-black text-slate-900">Welcome to Hub Central</h1>
      <p role="status" className="text-sm leading-6 text-slate-600">{message}</p>
      <button disabled={busy} onClick={() => signIn('procore')} className="w-full rounded-lg bg-teal-800 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? 'Waiting for sign-in…' : 'Continue with Procore'}</button>
      {allowEmail && <button disabled={busy} onClick={() => signIn('email')} className="w-full rounded-lg border border-slate-300 px-4 py-3 font-semibold text-slate-700 disabled:opacity-50">Sign in with email instead</button>}
      {openInTab && <a href={returnTo} target="_blank" rel="noopener noreferrer" className="block font-bold text-teal-800 underline">Open app in a new tab</a>}
      <Link href="/" className="block text-sm text-slate-600 underline">Home</Link>
    </section>
  </main>;
}
