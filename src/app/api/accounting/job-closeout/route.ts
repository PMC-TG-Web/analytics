import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import {
  canApproveCloseoutForecast,
  hasDatabasePageAccess,
  loadUserAssignedPermissionsFromDatabase,
} from '@/lib/permissions';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { changeCloseout, CloseoutFolderError, closeoutQueue } from '@/lib/jobCloseoutStore.mjs';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function handle(request: NextRequest, write: boolean) {
  try {
    const actor = await getRequestUserEmail(request);
    if (!actor) return json({ error: 'Sign in to review closeouts.' }, 401);
    if (!(await hasDatabasePageAccess(prisma, actor, 'page:/accounting/job-closeout')))
      return json({ error: 'Job closeout access is required.' }, 403);
    const company = process.env.PROCORE_COMPANY_ID;
    if (!company) throw Error('Missing company.');
    if (!write) {
      const project = request.nextUrl.searchParams.get('project');
      if (project && !/^\d+$/.test(project)) return json({ error: 'Invalid project.' }, 400);
      const projects = await closeoutQueue(prisma, company, project);
      const canZeroForecast =
        project && canApproveCloseoutForecast(await loadUserAssignedPermissionsFromDatabase(prisma, actor));
      return json({ projects: projects.map((row) => ({ ...row, canZeroForecast: Boolean(canZeroForecast) })) });
    }
    if (
      !validateCsrfRequest({
        method: request.method,
        requestUrl: request.url,
        origin: request.headers.get('origin'),
        referer: request.headers.get('referer'),
      }).allowed
    )
      return json({ error: 'Use the closeout page to record decisions.' }, 403);
    const raw = await request.text();
    if (raw.length > 6000) return json({ error: 'Request too large.' }, 413);
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }
    if (
      !input ||
      typeof input.projectId !== 'string' ||
      (input.folder != null && typeof input.folder !== 'string') ||
      (input.note != null && typeof input.note !== 'string')
    )
      return json({ error: 'Invalid closeout request.' }, 400);
    if (
      input.action === 'zeroForecast' &&
      !canApproveCloseoutForecast(await loadUserAssignedPermissionsFromDatabase(prisma, actor))
    )
      return json({ error: 'Forecast approval permission is required to zero forecasts in Procore.' }, 403);
    if (!(await changeCloseout(prisma, company, actor, input)))
      return json(
        {
          error:
            input.action === 'refresh'
              ? 'A newer review or a pending forecast update exists. Reload the report.'
              : input.action === 'zeroForecast'
                ? 'Refresh the report and review the current forecast amounts.'
                : 'The decision could not be saved. Reload the report and explain any remaining exceptions.',
        },
        409,
      );
    return json({ saved: true });
  } catch (error) {
    if (error instanceof CloseoutFolderError) return json({ error: error.message }, 400);
    return json({ error: 'Closeout data is unavailable. Reload to try again.' }, 503);
  }
}
export function GET(request: NextRequest) {
  return handle(request, false);
}
export function POST(request: NextRequest) {
  return handle(request, true);
}
