import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { canAccessSubcontractAllocation } from '@/lib/subcontractAllocationAccess';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { procoreConfig } from '@/lib/procore';
import { syncSubcontractAllocationGroups } from '@/lib/syncSubcontractAllocationGroups';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: NextRequest) {
  if (!validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to refresh group names.' }, 401);
  if (!canAccessSubcontractAllocation(actor)) return json({ error: 'Forbidden' }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 1000) return json({ error: 'Invalid request.' }, 400);
    const input = JSON.parse(raw);
    if (typeof input?.projectId !== 'string' || !/^\d+$/.test(input.projectId)) return json({ error: 'Invalid project.' }, 400);
    return json(await syncSubcontractAllocationGroups(procoreConfig.companyId, input.projectId));
  } catch { return json({ error: 'Group names could not be refreshed. Use Reload to retry.' }, 503); }
}
