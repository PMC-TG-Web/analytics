export function hasQboBillBridge() {
  return process.env.QBO_BILL_RELAY_ENABLED === 'true' || !!process.env.QBO_BILL_BRIDGE_URL?.trim();
}
export async function requestQboBillBridge<T>(body: unknown): Promise<T> {
  if (process.env.QBO_BILL_RELAY_ENABLED === 'true') {
    const { requestQboBillRelay } = await import('./qboBillRelay');
    return requestQboBillRelay<T>(body);
  }
  const raw = process.env.QBO_BILL_BRIDGE_URL?.trim();
  const secret = process.env.QBO_BILL_BRIDGE_SECRET;
  if (!raw || !secret || secret.length < 32) throw new Error('The shared QBO bill service is not configured.');
  const url = new URL(raw);
  const local = process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error('Configure a secure shared QBO bill service URL.');
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(55_000) });
  } catch { throw new Error('The shared QBO service is unavailable or still processing. Refresh the project review to check its saved status before trying again.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The shared QBO service rejected this request.');
  return data as T;
}
