import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { billBatchEnabled, billBatchMaxProjects, billBatchProjectOptions, getBillBatch, startBillBatch } from '@/lib/qboBillBatchStore';
import { dispatchBillBatch } from '@/lib/qboBillBatchDispatch';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: NextRequest) {
  if (!await getRequestUserEmail(request)) return json({ error: 'Sign in to view batch progress.' }, 401);
  if (!billBatchEnabled()) return json({ enabled: false, run: null });
  try {
    const companyId = request.nextUrl.searchParams.get('companyId') || '';
    const run = await getBillBatch(companyId, request.nextUrl.searchParams.get('month') || '');
    const active = await prisma.qboBillBatchRun.findUnique({ where: { activeKey: companyId }, select: { month: true } });
    const projects = await billBatchProjectOptions(companyId);
    return json({ enabled: true, run, activeMonth: active?.month || null, projects, maxProjects: billBatchMaxProjects() });
  }
  catch { return json({ error: 'Unable to load monthly batch progress.' }, 400); }
}
export async function POST(request: NextRequest) {
  if (!validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to update monthly bills.' }, 401);
  if (!billBatchEnabled()) return json({ error: 'Monthly batch updates are not enabled.' }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 8000) return json({ error: 'Invalid batch request.' }, 400);
    const body = JSON.parse(raw);
    const run = await startBillBatch(String(body.companyId || ''), String(body.month || ''), actor, String(body.requestKey || ''), body.retryOf ? String(body.retryOf) : undefined, body.projectIds);
    const dispatched = await dispatchBillBatch();
    return json({ runId: run.id, month: run.month, dispatched, message: dispatched ? 'Monthly update started.' : 'Run is saved and waiting for the background worker.' }, 202);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Unable to start the monthly update.' }, 409); }
}
