/** Keep HTML gateway/login responses out of the JSON parser and user-facing errors. */
export async function readBillResponse(response: Response) {
  if (response.status === 401) throw new Error('Your session has expired. Sign in again, then reopen Direct Cost Bills.');
  const json = /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '');
  if (response.status === 403 && json) throw new Error('Access was denied. Confirm that your employee permissions include Direct Cost Bills, then sign in again.');
  if (!json) {
    let login = false;
    try { login = response.redirected && /\/(?:login|authorize|auth)(?:\/|$)/i.test(new URL(response.url).pathname); } catch { /* No final URL supplied. */ }
    if (login) throw new Error('Your request was redirected to sign-in. Sign in again, then reopen Direct Cost Bills.');
    throw new Error(`The bill service returned a web page instead of data (HTTP ${response.status}). Refresh the page. If this continues, report this status and the site address to your administrator.`);
  }
  try { return await response.json(); }
  catch { throw new Error(`The bill service returned unreadable data (HTTP ${response.status}). Refresh the page and try again.`); }
}
/** Retry only safe reads, once, for transient gateway/non-JSON responses. */
export async function fetchBillRead(url: string, signal?: AbortSignal) {
  const options = { cache: 'no-store' as const, signal };
  const first = await fetch(url, options);
  const transient = [502, 503, 504].includes(first.status)
    || (first.ok && !first.redirected && !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(first.headers.get('content-type') || ''));
  if (!transient || signal?.aborted) return first;
  await first.body?.cancel();
  await new Promise(resolve => setTimeout(resolve, 500));
  signal?.throwIfAborted();
  return fetch(url, options);
}
