import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { refreshQboBillSources } from '@/lib/qboBillSourceRefresh';
import { refreshQboCostCatalog } from '@/lib/qboCostCatalogSync';
import { withProcoreLiveApiBypassForSyncSecret } from '@/lib/procore';
import { POST as syncPurchaseOrders } from '@/app/api/procore/sync/purchase-order-line-item-details/route';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const csrf = validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') });
  if (!csrf.allowed) return json({ error: 'A same-origin request is required.' }, 403);
  if (!await getRequestUserEmail(request)) return json({ error: 'Sign in to refresh costs.' }, 401);
  const body = await request.json().catch(() => null);
  const companyId = process.env.PROCORE_COMPANY_ID || '';
  if (!body || body.companyId !== companyId || !/^\d+$/.test(companyId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || '')) return json({ error: 'Invalid company or month.' }, 400);
  const secret = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET;
  if (!secret) return json({ error: 'Automatic Procore refresh is not configured.' }, 503);
  try {
    const internal = new Request('http://internal/catalog-refresh', { headers: { 'x-sync-secret': secret, 'x-procore-connection': 'shared' } });
    return json(await withProcoreLiveApiBypassForSyncSecret(internal, () => refreshQboBillSources(companyId, body.month, async projectId => {
      // Internal invocation preserves the sync-secret gate without forwarding credentials to a URL.
      const result = await syncPurchaseOrders(new Request('http://internal/api/procore/sync/purchase-order-line-item-details', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sync-secret': secret, 'x-procore-connection': 'shared' },
        body: JSON.stringify({ companyId, projectIds: [projectId], concurrency: 1, persist: true, persistUnpackedFields: false }),
      }));
      const data = await result.json();
      if (!result.ok || data.success === false || data.errors?.length || data.activeProjects?.some((p: { status?: string }) => p.status?.includes('unavailable'))) throw new Error('PO sync incomplete');
    }, () => refreshQboCostCatalog(companyId))));
  } catch { return json({ error: 'Cost Catalog or source refresh failed. Automatic checks will retry; the last synchronized costs remain visible.' }, 503); }
}
