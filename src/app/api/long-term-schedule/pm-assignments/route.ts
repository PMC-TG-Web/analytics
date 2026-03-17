import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

type PMAssignment = {
  assignmentKey?: string;
  jobKey: string;
  pmId: string;
  updatedAt: string;
};

function getStorePath() {
  return path.join(process.cwd(), 'data', 'long-term-pm-assignments.json');
}

function readAssignments(): PMAssignment[] {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[pm-assignments] Failed reading assignments file:', error);
    return [];
  }
}

function writeAssignments(assignments: PMAssignment[]) {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(storePath, JSON.stringify(assignments, null, 2), 'utf-8');
}

export async function GET() {
  try {
    const data = readAssignments();
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

    const assignments = readAssignments();
    const now = new Date().toISOString();
    const existingIndex = assignments.findIndex(
      (a) => (a.assignmentKey || a.jobKey) === resolvedKey
    );

    if (existingIndex >= 0) {
      assignments[existingIndex] = {
        assignmentKey: resolvedKey,
        jobKey: jobKey || assignments[existingIndex].jobKey || resolvedKey,
        pmId,
        updatedAt: now,
      };
    } else {
      assignments.push({
        assignmentKey: resolvedKey,
        jobKey: jobKey || resolvedKey,
        pmId,
        updatedAt: now,
      });
    }

    writeAssignments(assignments);

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

    const assignments = readAssignments();
    const filtered = assignments.filter((a) => (a.assignmentKey || a.jobKey) !== resolvedKey);
    writeAssignments(filtered);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete PM assignment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete PM assignment' },
      { status: 500 }
    );
  }
}
