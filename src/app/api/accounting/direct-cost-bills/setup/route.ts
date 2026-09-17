import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { loadQboDirectCosts } from '@/lib/loadQboDirectCosts';
import { requestQboBillBridge } from '@/lib/qboBillBridge';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const csrf = validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') });
  if (!csrf.allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to set up a project.' }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return json({ error: 'Invalid setup request.' }, 400);
    const body = JSON.parse(raw);
    if (body.companyId !== process.env.PROCORE_COMPANY_ID || !/^\d+$/.test(body.projectId || '') || !['setup-options', 'setup'].includes(body.operation) || (body.operation === 'setup' && !/^\d+$/.test(body.customerId || ''))) return json({ error: 'Choose a valid project and QBO customer.' }, 400);
    const draft = await loadQboDirectCosts(body.companyId, body.projectId, body.month);
    const result = await requestQboBillBridge({ operation: body.operation, companyId: body.companyId, projectId: body.projectId, month: draft.month, customerId: body.customerId, otherCostsConfirmed: body.otherCostsConfirmed === true, draft, actor });
    return json(result);
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Setup could not finish. Reopen setup to check saved progress before resuming.' }, 409); }
}
