import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { procoreConfig } from '@/lib/procore';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { loadSubcontractAllocation } from '@/lib/loadSubcontractAllocation';
import { allocationBudgetPlan, validateAllocationChanges, type AllocationSource } from '@/lib/subcontractAllocation';
import { sameAllocationSourceExceptGroupNames } from '@/lib/subcontractAllocationGroups';
import { canAccessSubcontractAllocation } from '@/lib/subcontractAllocationAccess';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const validProject = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value);

export async function GET(request: NextRequest) {
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to view allocations.' }, 401);
  if (!canAccessSubcontractAllocation(actor)) return json({ error: 'Forbidden' }, 403);
  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!validProject(projectId)) return json({ error: 'Select a project.' }, 400);
  try {
    const companyId = procoreConfig.companyId;
    const [current, draft] = await Promise.all([
      loadSubcontractAllocation(companyId, projectId),
      prisma.subcontractAllocationDraft.findUnique({ where: { companyId_projectId: { companyId, projectId } } }),
    ]);
    const labelsOnly = draft && sameAllocationSourceExceptGroupNames(current.source, draft.source as AllocationSource);
    return json({ ...current, draft: draft ? { revision: draft.revision, changes: draft.changes, source: labelsOnly ? current.source : draft.source,
      sourceFingerprint: labelsOnly ? current.fingerprint : draft.sourceFingerprint, updatedBy: draft.updatedBy, updatedAt: draft.updatedAt } : null });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return json({ error: 'Allocation storage is unavailable. Verify the allocation migration and database connection.' }, 503);
    return json({ error: error instanceof Error ? error.message : 'Unable to load allocation.' }, 409);
  }
}

export async function POST(request: NextRequest) {
  if (!validateCsrfRequest({ method: request.method, requestUrl: request.url, origin: request.headers.get('origin'), referer: request.headers.get('referer') }).allowed) return json({ error: 'A same-origin request is required.' }, 403);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to save allocations.' }, 401);
  if (!canAccessSubcontractAllocation(actor)) return json({ error: 'Forbidden' }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return json({ error: 'Draft is too large.' }, 413);
    const input = JSON.parse(raw);
    if (!input || !validProject(input.projectId) || !Number.isSafeInteger(input.revision) || input.revision < 0) return json({ error: 'Invalid project or revision.' }, 400);
    const companyId = procoreConfig.companyId;
    const { source, fingerprint } = await loadSubcontractAllocation(companyId, input.projectId);
    if (input.fingerprint !== fingerprint) return json({ error: 'Source data changed. Reload and review the current quantities before saving.' }, 409);
    const changes = validateAllocationChanges(source, input.changes);
    const key = { companyId, projectId: input.projectId };
    const data = { sourceFingerprint: fingerprint, source: JSON.parse(JSON.stringify(source)), changes: JSON.parse(JSON.stringify({ ...changes, budgetPlan: allocationBudgetPlan(source, changes) })) };
    const revision = input.revision + 1;
    await prisma.$transaction(async tx => {
      if (input.revision === 0) await tx.subcontractAllocationDraft.create({ data: { ...key, ...data, revision, updatedBy: actor } });
      else {
        const result = await tx.subcontractAllocationDraft.updateMany({ where: { ...key, revision: input.revision }, data: { ...data, revision, updatedBy: actor } });
        if (result.count !== 1) throw new Error('Another user saved this draft. Reload before saving your changes.');
      }
      await tx.subcontractAllocationRevision.create({ data: { ...key, ...data, revision, createdBy: actor } });
    });
    return json({ saved: true, revision, updatedBy: actor, updatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid request.' }, 400);
    if (error instanceof Prisma.PrismaClientKnownRequestError) return json({ error: error.code === 'P2002'
      ? 'Another user saved this draft. Reload before saving your changes.' : 'Draft storage is unavailable. Verify the allocation migration and database connection.' }, error.code === 'P2002' ? 409 : 503);
    return json({ error: error instanceof Error ? error.message : 'Unable to save draft.' }, 409);
  }
}
