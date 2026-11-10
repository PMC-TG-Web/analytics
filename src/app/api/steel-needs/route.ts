import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { loadSteelNeeds } from '@/lib/loadSteelNeeds';
import { wipCompanyId } from '@/lib/loadWipPlanning';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { parseSteelOrderInput, saveSteelOrderMark, SteelOrderConflict } from '@/lib/steelOrderMarks';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: NextRequest) {
  try {
    const actor = await getRequestUserEmail(request);
    if (!actor) return json({ error: 'Sign in to view Steel needs.' }, 401);
    if (!await hasDatabasePageAccess(prisma, actor, 'page:/steel-needs')) return json({ error: 'Steel needs access is required.' }, 403);
    return json(await loadSteelNeeds());
  } catch {
    return json({ error: 'Unable to load Steel needs. Retry or check estimate, WIP and field-entry synchronization.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  if (!validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) return json({ error: 'A same-origin request is required.' }, 403);
  try {
    const actor = await getRequestUserEmail(request);
    if (!actor) return json({ error: 'Sign in to update Steel needs.' }, 401);
    if (!await hasDatabasePageAccess(prisma, actor, 'page:/steel-needs')) return json({ error: 'Steel needs access is required.' }, 403);
    const raw = await request.text();
    if (raw.length > 5000) return json({ error: 'Request is too large.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid order mark.' }, 400); }
    const input = parseSteelOrderInput(body);
    if (!input) return json({ error: 'Invalid order mark.' }, 400);
    const report = await loadSteelNeeds();
    const item = report.projects.find(project => project.projectId === input.projectId)?.items.find(item => item.key === input.itemKey);
    if (!item || item.quantity !== input.quantity) return json({ error: 'The estimate changed. Refresh saved data before marking this item.' }, 409);
    return json({ order: await saveSteelOrderMark(prisma, wipCompanyId(), actor, input) });
  } catch (error) {
    if (error instanceof SteelOrderConflict) return json({ error: error.message }, 409);
    return json({ error: 'Unable to save the order mark. Refresh saved data before retrying.' }, 503);
  }
}
