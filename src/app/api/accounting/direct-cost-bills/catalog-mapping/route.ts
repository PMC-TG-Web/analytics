import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { loadQboCatalogMapping, saveQboCatalogMapping } from '@/lib/loadQboCatalogMapping';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: NextRequest) {
  if (!await getRequestUserEmail(request)) return json({ error: 'Sign in to map catalog items.' }, 401);
  const params = request.nextUrl.searchParams;
  const companyId = params.get('companyId') || '';
  if (companyId !== process.env.PROCORE_COMPANY_ID) return json({ error: 'Invalid company.' }, 400);
  try { return json(await loadQboCatalogMapping(companyId, params.get('projectId') || '', params.get('lineItemId') || '')); }
  catch (e) { return json({ error: e instanceof Error ? e.message : 'Unable to load catalog choices.' }, 409); }
}
export async function POST(request: NextRequest) {
  const csrf = validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') });
  if (!csrf.allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to save a catalog mapping.' }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return json({ error: 'Invalid mapping request.' }, 400);
    const body = JSON.parse(raw);
    if (body.companyId !== process.env.PROCORE_COMPANY_ID || ![body.companyId, body.projectId, body.lineItemId].every(id => typeof id === 'string' && /^\d+$/.test(id)) || !(body.catalogItemId === null || (typeof body.catalogItemId === 'string' && /^\d+$/.test(body.catalogItemId))) || !/^[a-f0-9]{64}$/.test(body.sourceSignature || '') || !Number.isInteger(body.revision) || body.revision < 0) return json({ error: 'Reopen the catalog picker and select an item.' }, 400);
    return json(await saveQboCatalogMapping(body, actor));
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Unable to save the mapping.' }, 409); }
}
