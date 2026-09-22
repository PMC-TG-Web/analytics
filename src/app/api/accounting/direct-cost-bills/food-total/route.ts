import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { saveQboFoodTotal } from '@/lib/saveQboFoodTotal';

export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const csrf = validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') });
  if (!csrf.allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to save Food costs.' }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return json({ error: 'Invalid Food total request.' }, 400);
    const body = JSON.parse(raw);
    if (!body || body.companyId !== process.env.PROCORE_COMPANY_ID || ![body.companyId, body.projectId].every(id => typeof id === 'string' && /^\d+$/.test(id)) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(body.month || '') || typeof body.amount !== 'string' || !Number.isInteger(body.revision) || body.revision < 0) return json({ error: 'Enter the Food total in a current project review.' }, 400);
    return json(await saveQboFoodTotal({ companyId: body.companyId, projectId: body.projectId, month: body.month, amount: body.amount, revision: body.revision }, actor));
  } catch (e) { return json({ error: e instanceof Error ? e.message : 'Unable to save the Food total.' }, 409); }
}
