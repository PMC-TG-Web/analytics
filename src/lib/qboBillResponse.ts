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

/** Finish every bounded read before exposing a selectable monthly worklist. */
export async function fetchBillQueue<Row extends { projectId: string; projectName: string; status: string }>(companyId: string, month: string, signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void) {
  const rows = new Map<string, Row>();
  const cursors = new Set<string>();
  let after: string | null = null;
  let generatedAt = '';
  do {
    signal?.throwIfAborted();
    const params = new URLSearchParams({ companyId, month, view: 'queue', paged: '1', ...(after ? { after } : {}) });
    const response = await fetchBillRead(`/api/accounting/direct-cost-bills?${params}`, signal);
    const data = await readBillResponse(response);
    if (!response.ok) throw new Error(data.error || 'Unable to load monthly bills.');
    if (!Array.isArray(data.rows)) throw new Error('The project list was incomplete. Refresh monthly bills.');
    signal?.throwIfAborted();
    for (const row of data.rows as Row[]) rows.set(row.projectId, row);
    generatedAt = data.generatedAt;
    onProgress?.(rows.size, data.totalProjects ?? rows.size);
    after = data.nextCursor ?? null;
    if (after !== null && (typeof after !== 'string' || !/^\d+$/.test(after) || cursors.has(after))) throw new Error('The project list changed. Refresh monthly bills.');
    if (after) cursors.add(after);
  } while (after);
  const priority: Record<string, number> = { update: 0, create: 1, blocked: 2, unavailable: 3, current: 4, no_activity: 5 };
  return { generatedAt, rows: [...rows.values()].sort((a, b) => priority[a.status] - priority[b.status] || a.projectName.localeCompare(b.projectName)) };
}
