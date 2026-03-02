import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const assignments = await prisma.equipmentAssignment.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const equipmentIds = Array.from(new Set(assignments.map((a) => a.equipmentId).filter(Boolean)));
    const projectIds = Array.from(new Set(assignments.map((a) => a.projectId).filter(Boolean))) as string[];
    const scopeIds = Array.from(new Set(assignments.map((a) => a.scopeId).filter(Boolean))) as string[];

    const [equipmentRows, projectRows, scopeRows] = (await Promise.all([
      equipmentIds.length
        ? prisma.equipment.findMany({
            where: { id: { in: equipmentIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      projectIds.length
        ? prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, projectName: true, customer: true, projectNumber: true },
          })
        : Promise.resolve([]),
      scopeIds.length
        ? prisma.projectScope.findMany({
            where: { id: { in: scopeIds } },
            select: { id: true, title: true, jobKey: true },
          })
        : Promise.resolve([]),
    ])) as [
      Array<{ id: string; name: string }>,
      Array<{ id: string; projectName: string; customer: string | null; projectNumber: string | null }>,
      Array<{ id: string; title: string; jobKey: string }>
    ];

    const equipmentMap = new Map(equipmentRows.map((row) => [row.id, row.name]));
    const projectMap = new Map(projectRows.map((row) => [row.id, row]));
    const scopeMap = new Map(scopeRows.map((row) => [row.id, row]));

    const data = assignments.map((row) => {
      const project = row.projectId ? projectMap.get(row.projectId) : null;
      const scope = row.scopeId ? scopeMap.get(row.scopeId) : null;

      return {
        id: row.id,
        equipmentId: row.equipmentId,
        equipmentName: equipmentMap.get(row.equipmentId) || 'Unknown',
        projectId: row.projectId || '',
        projectName: project?.projectName || '',
        jobKey:
          scope?.jobKey ||
          (project
            ? `${project.customer || ''}~${project.projectNumber || ''}~${project.projectName || ''}`
            : ''),
        scopeId: row.scopeId || undefined,
        scopeTitle: scope?.title || undefined,
        startDate: row.startDate,
        endDate: row.endDate,
        notes: row.notes || undefined,
        createdAt: row.createdAt.toISOString(),
      };
    });

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Failed to fetch equipment assignments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch equipment assignments' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const equipmentId = (body?.equipmentId || '').toString().trim();
    const projectIdRaw = (body?.projectId || '').toString().trim();
    const scopeIdRaw = (body?.scopeId || '').toString().trim();
    const startDate = (body?.startDate || '').toString().trim();
    const endDate = (body?.endDate || '').toString().trim();
    const notes = (body?.notes || '').toString().trim();

    if (!equipmentId || !startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'equipmentId, startDate, and endDate are required' },
        { status: 400 }
      );
    }

    const created = await prisma.equipmentAssignment.create({
      data: {
        equipmentId,
        projectId: projectIdRaw || null,
        scopeId: scopeIdRaw || null,
        startDate,
        endDate,
        notes: notes || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: created.id,
        equipmentId: created.equipmentId,
        projectId: created.projectId,
        scopeId: created.scopeId,
        startDate: created.startDate,
        endDate: created.endDate,
        notes: created.notes,
        createdAt: created.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Failed to create equipment assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create equipment assignment' },
      { status: 500 }
    );
  }
}
