import { NextRequest, NextResponse } from 'next/server';
import { loadQboDirectCosts } from '@/lib/loadQboDirectCosts';
import { requestQboBillBridge } from '@/lib/qboBillBridge';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const csrf = validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') });
  if (!csrf.allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in before reconciling a bill.' }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return json({ error: 'Invalid reconciliation request.' }, 400);
    const body = JSON.parse(raw);
    if (!body || body.companyId !== process.env.PROCORE_COMPANY_ID || !/^\d+$/.test(body.companyId || '') || !/^\d+$/.test(body.projectId || '') || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month || '') || !['preview', 'confirm'].includes(body.operation) || (body.operation === 'confirm' && !/^[a-f0-9]{64}$/.test(body.fingerprint || ''))) return json({ error: 'Reopen the project reconciliation.' }, 400);
    const draft = await loadQboDirectCosts(body.companyId, body.projectId, body.month);
    return json(await requestQboBillBridge({ operation: `reconcile-${body.operation}`, companyId: body.companyId, projectId: body.projectId, month: body.month, fingerprint: body.fingerprint, draft, actor }));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unable to reconcile this bill.' }, 409);
  }
}
