import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadQboDirectCosts } from '@/lib/loadQboDirectCosts';
import { loadQboBillReview } from '@/lib/loadQboBillReview';
import { loadQboBillQueue } from '@/lib/loadQboBillQueue';
import { requestQboBillBridge } from '@/lib/qboBillBridge';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const params = request.nextUrl.searchParams;
  const companyId = params.get('companyId') || process.env.PROCORE_COMPANY_ID || '';
  if (!/^\d+$/.test(companyId)) return json({ error: 'Company ID is required.' }, 400);
  try {
    if (params.get('view') === 'queue') return json(await loadQboBillQueue(companyId, params.get('month') || ''));
    if (!params.has('projectId')) {
      const projects = await prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, projectName: true, projectNumber: true }, orderBy: { projectName: 'asc' } });
      return json({ companyId, projects });
    }
    const draft = await loadQboDirectCosts(companyId, params.get('projectId') || '', params.get('month') || '');
    const review = await loadQboBillReview(companyId, draft.projectId, draft.month, draft, true);
    // Display trusted host prices; POST still rebuilds source data and re-reads QBO.
    const lines = draft.lines.map(line => review.qboPrices[line.lineKey] ? { ...line, ...review.qboPrices[line.lineKey] } : line);
    return json({ ...draft, lines, total: review.grossTotal == null ? draft.total : review.grossTotal.toFixed(2), review });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/Choose a valid month|Company and Procore|Project not found/.test(message)) return json({ error: message }, 400);
    console.error('Direct cost bill preview failed');
    return json({ error: 'Unable to load the direct cost preview.' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const csrf = validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') });
  if (!csrf.allowed) return json({ error: 'A same-origin request is required.' }, 403);
  // Middleware requires the existing accounting permission; record the session operator.
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in before posting a bill.' }, 401);
  try {
    const raw = await request.text();
    if (raw.length > 2000) return json({ error: 'Invalid bill request.' }, 400);
    const body = JSON.parse(raw);
    if (!/^\d+$/.test(body.companyId || '') || !/^\d+$/.test(body.projectId || '') || !/^[a-f0-9]{64}$/.test(body.fingerprint || '')) return json({ error: 'Reopen the project review before posting.' }, 400);
    // Never trust browser-supplied costs or mapping IDs. Rebuild from the synchronized database.
    const draft = await loadQboDirectCosts(body.companyId, body.projectId, body.month);
    const receipt = await requestQboBillBridge({ operation: 'post', companyId: body.companyId, projectId: body.projectId, month: body.month, fingerprint: body.fingerprint, draft, actor });
    return json({ success: true, receipt });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unable to save this bill. Refresh its review before retrying.' }, 409);
  }
}
