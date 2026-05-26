import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema } from '@/lib/ganttV2Db';
import { invalidateCacheByPrefix } from '@/lib/serverReadCache';

export const dynamic = 'force-dynamic';

type RouteParams = {
  params: Promise<{ projectId: string }>;
};

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { projectId } = await params;
    const companyId = String(request.cookies.get('procore_company_id')?.value || '').trim();

    const project = await prisma.$queryRawUnsafe<Array<{
      customer: string | null;
      project_number: string | null;
      project_name: string;
      source: string | null;
      source_company_id: string | null;
    }>>(
      `SELECT customer, project_number, project_name, source, source_company_id FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
      projectId
    );

    if (!project || project.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const { customer, project_number, project_name, source, source_company_id } = project[0];
    const normalizedSource = String(source || '').trim().toLowerCase();
    const sourceCompanyId = String(source_company_id || '').trim();

    if (normalizedSource === 'procore' && (!companyId || sourceCompanyId !== companyId)) {
      return NextResponse.json({ success: false, error: 'Project is not accessible in this company context' }, { status: 403 });
    }

    const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;

    await prisma.activeSchedule.deleteMany({ where: { jobKey } });
    await prisma.projectScope.deleteMany({ where: { jobKey } });
    await prisma.$executeRawUnsafe(`DELETE FROM gantt_v2_scopes WHERE project_id = $1`, projectId);
    await prisma.$executeRawUnsafe(`DELETE FROM gantt_v2_projects WHERE id = $1`, projectId);

    invalidateCacheByPrefix('gantt-v2:');
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to delete project: ${String(error)}` },
      { status: 500 }
    );
  }
}