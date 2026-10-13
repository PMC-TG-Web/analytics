import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { wipCompanyId, loadWipPlanning } from '@/lib/loadWipPlanning';
import { getClientCredentialsToken, makeRequest, withProcoreLiveApiBypassForAuthenticatedSession } from '@/lib/procore';
import { fetchWipProjectTeam } from '@/lib/wipProjectTeam';
import { saveWipProjectTeam } from '@/lib/wipProjectTeamStore';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: NextRequest) {
  if (!validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to use WIP.' }, 401);
  if (!await hasDatabasePageAccess(prisma, actor, 'wip')) return json({ error: 'WIP access is required.' }, 403);
  try {
    const input = await request.json();
    if (typeof input?.projectId !== 'string' || !/^\d+$/.test(input.projectId)) return json({ error: 'Invalid project.' }, 400);
    if (!(await loadWipPlanning()).some(project => project.projectId === input.projectId)) return json({ error: 'This job is no longer in WIP. Refresh the page.' }, 409);
    return await withProcoreLiveApiBypassForAuthenticatedSession(request, async () => {
      const companyId = wipCompanyId();
      const token = request.cookies.get('procore_access_token')?.value || await getClientCredentialsToken();
      const team = await fetchWipProjectTeam(companyId, input.projectId, path => makeRequest(path, token, undefined, companyId));
      await saveWipProjectTeam(team);
      return json({ team });
    });
  } catch {
    return json({ error: 'Unable to refresh Project Team from Procore. Previously saved PMs were retained. Retry after checking the Procore connection.' }, 503);
  }
}
