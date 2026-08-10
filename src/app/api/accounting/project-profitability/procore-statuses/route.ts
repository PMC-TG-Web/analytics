import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

async function requireAdministrator(request: NextRequest) {
  const email = await getRequestUserEmail(request);
  if (!email) return { allowed: false as const, response: noStoreJson({ error: 'Unauthorized' }, 401) };
  const assigned = await loadUserAssignedPermissionsFromDatabase(prisma, email);
  const allowed = assigned.some((permission) => [
    'OWNER',
    'ADMIN',
    'ACCOUNTING-PROJECT-PROFITABILITY',
  ].includes(permission.toUpperCase()));
  if (!allowed) return { allowed: false as const, response: noStoreJson({ error: 'Forbidden' }, 403) };
  return { allowed: true as const };
}

export async function GET(request: NextRequest) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator.allowed) return administrator.response;

    const companyId = process.env.PROCORE_COMPANY_ID?.trim() || '598134325805519';
    const projects = await prisma.pmcProject.findMany({
      where: { companyId },
      select: {
        procoreProjectId: true,
        bidBoardStatus: true,
        status: true,
      },
    });

    const byProjectId: Record<string, string> = {};
    const statuses = new Set<string>();
    for (const project of projects) {
      const status = String(project.bidBoardStatus || project.status || '').trim();
      if (!status) continue;
      byProjectId[project.procoreProjectId] = status;
      statuses.add(status);
    }

    return noStoreJson({
      success: true,
      statuses: Array.from(statuses).sort((left, right) => left.localeCompare(right)),
      byProjectId,
    });
  } catch (error) {
    console.error('Failed to load Procore statuses for QBO profitability:', error);
    return noStoreJson({ error: 'Failed to load Procore project statuses' }, 500);
  }
}
