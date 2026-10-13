import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { loadWipPlanning, wipCompanyId } from '@/lib/loadWipPlanning';
import { validateWipAllocations } from '@/lib/wipPlanning';
import { readWipLocalStore, saveWipLocalPlan, wipLocalStorePath } from '@/lib/wipLocalStore';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function access(request: NextRequest) {
  const actor = await getRequestUserEmail(request);
  if (!actor) return { response: json({ error: 'Sign in to use WIP.' }, 401) };
  if (!await hasDatabasePageAccess(prisma, actor, 'wip')) return { response: json({ error: 'WIP access is required.' }, 403) };
  return { actor };
}

function failure(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return json({ error: 'Another user saved this plan. Reload before saving your changes.' }, 409);
  return json({ error: 'WIP is temporarily unavailable. Please retry; if this persists, check the WIP migration and source synchronization.' }, 503);
}

export async function GET(request: NextRequest) {
  const auth = await access(request);
  if (auth.response) return auth.response;
  try {
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (projectId) {
      if (!/^\d+$/.test(projectId)) return json({ error: 'Invalid project.' }, 400);
      const localPath = wipLocalStorePath();
      if (localPath) {
        const local = await readWipLocalStore(localPath, wipCompanyId());
        return json({ history: (local.history[projectId] || []).slice(-50).reverse() });
      }
      const history = await prisma.wipPlanRevision.findMany({
        where: { companyId: wipCompanyId(), projectId }, orderBy: { revision: 'desc' }, take: 50,
        select: { revision: true, source: true, allocations: true, notes: true, createdBy: true, createdAt: true },
      });
      return json({ history });
    }
    return json({ projects: await loadWipPlanning(), localOnly: !!wipLocalStorePath() });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  if (!validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const auth = await access(request);
  if (auth.response) return auth.response;
  try {
    const raw = await request.text();
    if (raw.length > 30000) return json({ error: 'Plan is too large.' }, 413);
    let input;
    try { input = JSON.parse(raw); } catch { return json({ error: 'Invalid request.' }, 400); }
    if (!input || typeof input.projectId !== 'string' || !/^\d+$/.test(input.projectId)
      || !Number.isSafeInteger(input.revision) || input.revision < 0
      || typeof input.notes !== 'string' || input.notes.length > 4000) return json({ error: 'Invalid project, revision, or notes (maximum 4,000 characters).' }, 400);
    let allocations;
    try { allocations = validateWipAllocations(input.allocations); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid allocation.' }, 400); }
    const project = (await loadWipPlanning(true)).find(row => row.projectId === input.projectId);
    if (!project) return json({ error: 'This job is no longer In Progress. Reload WIP.' }, 409);
    if (project.issue) return json({ error: project.issue }, 409);
    if (input.fingerprint !== project.fingerprint) return json({ error: 'The estimate changed. Reload and review its current hours before saving.' }, 409);
    const key = { companyId: wipCompanyId(), projectId: input.projectId };
    const revision = input.revision + 1;
    const data = { source: { ...project.source }, allocations, notes: input.notes.trim(), revision };
    const localPath = wipLocalStorePath();
    if (localPath) {
      const plan = await saveWipLocalPlan(localPath, key.companyId, key.projectId, input.revision, data, auth.actor!);
      return plan ? json({ plan }) : json({ error: 'Another user saved this plan. Reload before saving your changes.' }, 409);
    }
    const result = await prisma.$transaction(async tx => {
      if (input.revision === 0) await tx.wipPlan.create({ data: { ...key, ...data, updatedBy: auth.actor! } });
      else {
        const updated = await tx.wipPlan.updateMany({ where: { ...key, revision: input.revision }, data: { ...data, updatedBy: auth.actor! } });
        if (updated.count !== 1) return null;
      }
      await tx.wipPlanRevision.create({ data: { ...key, ...data, createdBy: auth.actor! } });
      return tx.wipPlan.findUniqueOrThrow({ where: { companyId_projectId: key } });
    });
    if (!result) return json({ error: 'Another user saved this plan. Reload before saving your changes.' }, 409);
    return json({ plan: { revision: result.revision, source: result.source, allocations: result.allocations, notes: result.notes, updatedBy: result.updatedBy, updatedAt: result.updatedAt } });
  } catch (error) { return failure(error); }
}
