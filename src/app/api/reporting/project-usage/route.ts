import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { usagePeriod } from '@/lib/projectUsageReport';
import { loadProjectUsageReport } from '@/lib/loadProjectUsageReport';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: NextRequest) {
  try {
    const email = await getRequestUserEmail(request);
    if (!email) return json({ error: 'Sign in to run this report.' }, 401);
    if (!await hasDatabasePageAccess(prisma, email, 'reporting')) return json({ error: 'Reporting permission is required.' }, 403);
    const from = request.nextUrl.searchParams.get('from') || '';
    const through = request.nextUrl.searchParams.get('through') || '';
    try { usagePeriod(from, through); } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Invalid dates.' }, 400);
    }
    const companyId = process.env.PROCORE_COMPANY_ID?.trim();
    if (!companyId) return json({ error: 'The Procore company is not configured.' }, 503);
    if (request.nextUrl.searchParams.get('view') === 'projects') {
      const projects = await prisma.pmcProject.findMany({ where: { companyId },
        select: { procoreProjectId: true, projectName: true, projectNumber: true },
        orderBy: [{ projectName: 'asc' }, { procoreProjectId: 'asc' }],
      });
      return json({ projects: projects.map(p => ({ projectId: p.procoreProjectId, projectName: p.projectName, projectNumber: p.projectNumber || '' })) });
    }
    return json(await loadProjectUsageReport(companyId, from, through));
  } catch (error) {
    console.error('[project-usage-report] Read failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'Unable to load the report. No partial totals are shown. Please retry.' }, 503);
  }
}
