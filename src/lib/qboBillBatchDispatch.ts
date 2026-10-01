export async function dispatchBillBatch() {
  if (process.env.QBO_BILL_BATCH_ENABLED !== 'true') return false;
  const base = process.env.APP_BASE_URL || process.env.URL;
  const secret = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET;
  if (!base || !secret) return false;
  const url = new URL('/api/background/qbo-bill-batch', base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) return false;
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'x-sync-secret': secret }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (response.status === 202) return true;
    console.error('[qbo-bill-batch] Worker dispatch rejected', { status: response.status });
    return false;
  } catch {
    console.error('[qbo-bill-batch] Worker dispatch failed');
    return false;
  }
}
