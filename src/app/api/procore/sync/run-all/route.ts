// POST /api/procore/sync/run-all
// Runs every necessary sync in sequence:
//   projects feed → prime contracts → change-order packages →
//   commitment contracts → commitment CO line items → bids →
//   timecard entries → productivity logs → budget line items
// Each step is attempted independently so a failure in one does not abort the rest.
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const SYNC_SECRET = process.env.PROCORE_SYNC_SECRET || '';

type StepResult = {
  step: string;
  ok: boolean;
  status?: number;
  summary?: unknown;
  error?: string;
};

async function callSync(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  accessToken: string,
  companyId: string
): Promise<StepResult> {
  const label = path.replace('/api/procore/sync/', '');
  try {
    const res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `procore_access_token=${accessToken}; procore_company_id=${companyId}`,
        ...(SYNC_SECRET ? { 'x-sync-secret': SYNC_SECRET } : {}),
      },
      body: JSON.stringify(body),
    });
    let data: unknown;
    try { data = await res.json(); } catch { data = null; }
    return { step: label, ok: res.ok, status: res.status, summary: data };
  } catch (err) {
    return { step: label, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('procore_access_token')?.value || '';
  const companyId = cookieStore.get('procore_company_id')?.value || '';

  if (!accessToken) {
    return NextResponse.json({ success: false, error: 'Not authenticated. Please connect Procore first.' }, { status: 401 });
  }

  const origin = new URL(request.url).origin;
  const started = Date.now();
  const results: StepResult[] = [];

  // Rolling date window: 90 days back → today (covers timecards & productivity)
  const today = new Date().toISOString().split('T')[0];
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 1. Projects feed — must run first; all downstream syncs read project IDs from this table
  results.push(await callSync(origin, '/api/procore/sync/all-projects', { fetchAll: true }, accessToken, companyId));

  // 2. Prime contracts
  results.push(await callSync(origin, '/api/procore/sync/prime-contracts', { concurrency: 2 }, accessToken, companyId));

  // 3. Change-order packages
  results.push(await callSync(origin, '/api/procore/sync/change-order-packages', { limitProjects: 10000, concurrency: 2 }, accessToken, companyId));

  // 4. Commitment contracts (subcontracts)
  results.push(await callSync(origin, '/api/procore/sync/commitment-contracts', { concurrency: 2 }, accessToken, companyId));

  // 5. Commitment change-order line items (depends on commitment contracts existing)
  results.push(await callSync(origin, '/api/procore/sync/commitment-change-order-line-items', { concurrency: 2 }, accessToken, companyId));

  // 6. Bids (company-wide)
  results.push(await callSync(origin, '/api/procore/sync/bids', { companyWide: true, fetchAll: true }, accessToken, companyId));

  // 7. Timecard entries — rolling 90-day window, concurrency 2 to stay safe
  results.push(await callSync(origin, '/api/procore/sync/timecard-entries', { startDate: ninetyDaysAgo, endDate: today, concurrency: 2 }, accessToken, companyId));

  // 8. Productivity logs — rolling 90-day window, concurrency 2 to stay safe
  results.push(await callSync(origin, '/api/procore/sync/productivity-projects', { startDate: ninetyDaysAgo, endDate: today, concurrency: 2 }, accessToken, companyId));

  // 9. Budget line items (company-wide, all projects)
  results.push(await callSync(origin, '/api/procore/sync/budget-line-items', { limitProjects: 10000, fetchAll: true }, accessToken, companyId));

  // 10. Company users (cached for DB-first /api/procore/company-users)
  results.push(await callSync(origin, '/api/procore/sync/company-users', {}, accessToken, companyId));

  // 11. Company vendors (cached for DB-first /api/procore/vendors)
  results.push(await callSync(origin, '/api/procore/sync/vendors', {}, accessToken, companyId));

  // 12. Estimating catalogs (cached for DB-first /api/procore/estimating/catalogs)
  results.push(await callSync(origin, '/api/procore/sync/estimating-catalogs', {}, accessToken, companyId));

  const elapsedMs = Date.now() - started;
  const allOk = results.every((r) => r.ok);

  return NextResponse.json({
    success: allOk,
    elapsedMs,
    steps: results,
  });
}
