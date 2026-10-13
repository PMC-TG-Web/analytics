'use client';
import { useEffect, useState } from 'react';

export function useKpiReport<T>(endpoint: string) {
  const [report, setReport] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let controller: AbortController | null = null;
    async function load() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch(endpoint, { cache: 'no-store', credentials: 'include', signal: request.signal });
        const body = await response.json();
        if (!response.ok || !body.data) throw new Error(body.error || 'Could not load KPI totals.');
        if (!request.signal.aborted) { setReport(body.data); setError(''); }
      } catch (error) {
        if (!request.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load KPI totals.');
      }
    }
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => { controller?.abort(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.clearInterval(interval); };
  }, [retry, endpoint]);
  return { report, error, retry: () => setRetry(value => value + 1) };
}
