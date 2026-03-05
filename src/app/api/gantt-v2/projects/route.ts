import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema, getGanttV2ProjectsWithScopes } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureGanttV2Schema();
    const projects = await getGanttV2ProjectsWithScopes();
    return NextResponse.json({ success: true, data: projects });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to load Gantt V2 projects: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureGanttV2Schema();
    const body = await request.json();

    const projectName = (body?.projectName || '').toString().trim();
    const customer = (body?.customer || '').toString().trim() || null;
    const projectNumber = (body?.projectNumber || '').toString().trim() || null;
    const status = (body?.status || '').toString().trim() || null;

    if (!projectName) {
      return NextResponse.json(
        { success: false, error: 'projectName is required' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO gantt_v2_projects (id, project_name, customer, project_number, status)
        VALUES ($1, $2, $3, $4, $5);
      `,
      id,
      projectName,
      customer,
      projectNumber,
      status
    );

    return NextResponse.json({ success: true, data: { id, projectName, customer, projectNumber, status } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to create Gantt V2 project: ${String(error)}` },
      { status: 500 }
    );
  }
}
