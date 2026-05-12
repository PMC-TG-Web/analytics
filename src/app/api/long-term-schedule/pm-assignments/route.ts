import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { shouldFallbackToEmptyRead } from '@/lib/dbResilience';

export const dynamic = 'force-dynamic';

type PMAssignment = {
  assignmentKey?: string;
  jobKey: string;
  pmId: string;
  updatedAt: string;
};

type PMAssignmentRow = {
  assignment_key: string;
  job_key: string;
  pm_id: string;
  updated_at: Date;
};

const normalizeProjectAssignmentKey = (assignmentKey: string, jobKey: string) =>
  (jobKey || assignmentKey || '').trim();

async function deleteStaleScopeLevelAssignments(jobKey: string) {
  const normalizedJobKey = String(jobKey || '').trim();
  if (!normalizedJobKey) return;

  await prisma.$executeRaw`
    DELETE FROM long_term_pm_assignments
    WHERE job_key = ${normalizedJobKey}
      AND assignment_key <> ${normalizedJobKey}
  `;
}

async function reconcileProjectLevelAssignments() {
  const rows = await prisma.$queryRaw<PMAssignmentRow[]>`
    SELECT assignment_key, job_key, pm_id, updated_at
    FROM long_term_pm_assignments
    ORDER BY updated_at DESC
  `;

  const groupedByJobKey = new Map<string, PMAssignmentRow[]>();
  rows.forEach((row) => {
    const normalizedJobKey = String(row.job_key || '').trim();
    if (!normalizedJobKey) return;
    if (!groupedByJobKey.has(normalizedJobKey)) {
      groupedByJobKey.set(normalizedJobKey, []);
    }
    groupedByJobKey.get(normalizedJobKey)!.push(row);
  });

  for (const [jobKey, groupRows] of groupedByJobKey.entries()) {
    if (groupRows.length === 0) continue;

    const projectLevelRow = groupRows.find(
      (row) => String(row.assignment_key || '').trim() === jobKey
    );
    const winningRow = projectLevelRow || groupRows[0];
    if (!winningRow?.pm_id) continue;

    await prisma.$executeRaw`
      INSERT INTO long_term_pm_assignments (assignment_key, job_key, pm_id, updated_at)
      VALUES (${jobKey}, ${jobKey}, ${winningRow.pm_id}, ${winningRow.updated_at})
      ON CONFLICT (assignment_key)
      DO UPDATE SET
        job_key = EXCLUDED.job_key,
        pm_id = EXCLUDED.pm_id,
        updated_at = EXCLUDED.updated_at
    `;

    await prisma.$executeRaw`
      DELETE FROM long_term_pm_assignments
      WHERE job_key = ${jobKey}
        AND assignment_key <> ${jobKey}
    `;
  }
}

async function backfillLegacyAssignmentsIfEmpty() {
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
    await backfillLegacyAssignmentsIfEmpty();
    await reconcileProjectLevelAssignments();

    const rows = await prisma.$queryRaw<PMAssignmentRow[]>`
      SELECT assignment_key, job_key, pm_id, updated_at
      FROM long_term_pm_assignments
      WHERE assignment_key = job_key
      ORDER BY updated_at DESC
    `;

    const data: PMAssignment[] = rows.map((row) => ({
      assignmentKey: row.assignment_key,
      jobKey: row.job_key,
      pmId: row.pm_id,
      updatedAt: row.updated_at.toISOString(),
    }));

    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    console.error('Failed to fetch PM assignments:', error);
    if (shouldFallbackToEmptyRead(error)) {
      return NextResponse.json({ success: true, data: [] });
    }
    return NextResponse.json(
      { success: false, error: 'Failed to fetch PM assignments' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await backfillLegacyAssignmentsIfEmpty();

    const body = await request.json();
    const assignmentKey = (body?.assignmentKey || '').trim();
    const jobKey = (body?.jobKey || '').trim();
    const pmId = (body?.pmId || '').trim();
    const resolvedKey = normalizeProjectAssignmentKey(assignmentKey, jobKey);
    const normalizedJobKey = jobKey || resolvedKey;

    if (!resolvedKey || !pmId) {
      return NextResponse.json(
        { success: false, error: 'assignmentKey (or jobKey) and pmId are required' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    await deleteStaleScopeLevelAssignments(normalizedJobKey);

    await prisma.$executeRaw`
      INSERT INTO long_term_pm_assignments (assignment_key, job_key, pm_id, updated_at)
      VALUES (${resolvedKey}, ${normalizedJobKey}, ${pmId}, ${new Date(now)})
      ON CONFLICT (assignment_key)
      DO UPDATE SET
        job_key = EXCLUDED.job_key,
        pm_id = EXCLUDED.pm_id,
        updated_at = EXCLUDED.updated_at
    `;

    return NextResponse.json({
      success: true,
      data: { assignmentKey: resolvedKey, jobKey: normalizedJobKey, pmId, updatedAt: now },
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
    await backfillLegacyAssignmentsIfEmpty();

    const body = await request.json();
    const assignmentKey = (body?.assignmentKey || '').trim();
    const jobKey = (body?.jobKey || '').trim();
    const resolvedKey = normalizeProjectAssignmentKey(assignmentKey, jobKey);
    const normalizedJobKey = jobKey || resolvedKey;

    if (!resolvedKey) {
      return NextResponse.json(
        { success: false, error: 'assignmentKey (or jobKey) is required' },
        { status: 400 }
      );
    }

    await deleteStaleScopeLevelAssignments(normalizedJobKey);

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
