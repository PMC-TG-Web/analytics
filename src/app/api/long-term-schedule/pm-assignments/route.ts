import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

type PMAssignment = {
  assignmentKey?: string;
  jobKey: string;
  pmId: string;
  updatedAt: string;
};

async function ensureAssignmentsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS long_term_pm_assignments (
      assignment_key TEXT PRIMARY KEY,
      job_key TEXT NOT NULL,
      pm_id TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // One-time migration from legacy local JSON file if table is empty.
  const existingCountRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM long_term_pm_assignments
  `;
  const existingCount = Number(existingCountRows[0]?.count || 0);
  if (existingCount > 0) return;

  const legacyPath = path.join(process.cwd(), 'data', 'long-term-pm-assignments.json');
  if (!fs.existsSync(legacyPath)) return;

  try {
    const raw = fs.readFileSync(legacyPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    for (const row of parsed) {
      const assignmentKey = typeof row?.assignmentKey === 'string' && row.assignmentKey.trim()
        ? row.assignmentKey.trim()
        : (typeof row?.jobKey === 'string' ? row.jobKey.trim() : '');
      const jobKey = typeof row?.jobKey === 'string' ? row.jobKey.trim() : assignmentKey;
      const pmId = typeof row?.pmId === 'string' ? row.pmId.trim() : '';
      const updatedAt = typeof row?.updatedAt === 'string' && row.updatedAt
        ? new Date(row.updatedAt)
        : new Date();

      if (!assignmentKey || !jobKey || !pmId) continue;

      await prisma.$executeRaw`
        INSERT INTO long_term_pm_assignments (assignment_key, job_key, pm_id, updated_at)
        VALUES (${assignmentKey}, ${jobKey}, ${pmId}, ${updatedAt})
        ON CONFLICT (assignment_key)
        DO UPDATE SET
          job_key = EXCLUDED.job_key,
          pm_id = EXCLUDED.pm_id,
          updated_at = EXCLUDED.updated_at
      `;
    }
  } catch (error) {
    console.warn('[pm-assignments] Failed to migrate legacy JSON assignments:', error);
  }
}

export async function GET() {
  try {
    await ensureAssignmentsTable();

    const rows = await prisma.$queryRaw<Array<{
      assignment_key: string;
      job_key: string;
      pm_id: string;
      updated_at: Date;
    }>>`
      SELECT assignment_key, job_key, pm_id, updated_at
      FROM long_term_pm_assignments
      ORDER BY updated_at DESC
    `;

    const data: PMAssignment[] = rows.map((row) => ({
      assignmentKey: row.assignment_key,
      jobKey: row.job_key,
      pmId: row.pm_id,
      updatedAt: row.updated_at.toISOString(),
    }));

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to fetch PM assignments:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch PM assignments' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureAssignmentsTable();

    const body = await request.json();
    const assignmentKey = (body?.assignmentKey || '').trim();
    const jobKey = (body?.jobKey || '').trim();
    const pmId = (body?.pmId || '').trim();
    const resolvedKey = assignmentKey || jobKey;

    if (!resolvedKey || !pmId) {
      return NextResponse.json(
        { success: false, error: 'assignmentKey (or jobKey) and pmId are required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    await prisma.$executeRaw`
      INSERT INTO long_term_pm_assignments (assignment_key, job_key, pm_id, updated_at)
      VALUES (${resolvedKey}, ${jobKey || resolvedKey}, ${pmId}, ${new Date(now)})
      ON CONFLICT (assignment_key)
      DO UPDATE SET
        job_key = EXCLUDED.job_key,
        pm_id = EXCLUDED.pm_id,
        updated_at = EXCLUDED.updated_at
    `;

    return NextResponse.json({
      success: true,
      data: { assignmentKey: resolvedKey, jobKey: jobKey || resolvedKey, pmId, updatedAt: now },
    });
  } catch (error) {
    console.error('Failed to save PM assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save PM assignment' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureAssignmentsTable();

    const body = await request.json();
    const assignmentKey = (body?.assignmentKey || '').trim();
    const jobKey = (body?.jobKey || '').trim();
    const resolvedKey = assignmentKey || jobKey;

    if (!resolvedKey) {
      return NextResponse.json(
        { success: false, error: 'assignmentKey (or jobKey) is required' },
        { status: 400 }
      );
    }

    await prisma.$executeRaw`
      DELETE FROM long_term_pm_assignments
      WHERE assignment_key = ${resolvedKey}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete PM assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete PM assignment' },
      { status: 500 }
    );
  }
}
