import { NextRequest, NextResponse } from 'next/server';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QboLine = {
  id: string;
  sectionPath: string[];
  date: string | null;
  txnType: string | null;
  docNum: string | null;
  name: string | null;
  className: string | null;
  memo: string | null;
  splitAccount: string | null;
  amount: number;
};

type QboProjectDrillthrough = {
  qboCustomerId: string;
  projectName: string;
  fullyQualifiedName: string;
  qboCostDrillthroughKey?: string;
  status?: string;
  total?: number | null;
  lineCount?: number;
  breakdown?: Array<{ section: string; amount: number }>;
  lines?: QboLine[];
};

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
  const allowed = assigned.some((permission) => ['OWNER', 'ADMIN'].includes(permission.toUpperCase()));
  if (!allowed) return { allowed: false as const, response: noStoreJson({ error: 'Forbidden' }, 403) };
  return { allowed: true as const, email };
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

function toProjectDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function resolveQboWorkspaceRoot() {
  const analyticsRoot = process.cwd();
  return process.env.QBO_INTEGRATION_ROOT?.trim() || path.resolve(analyticsRoot, '..', 'QBO_1');
}

function normalizeLines(lines: unknown): QboLine[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((line, index) => {
    const record = line && typeof line === 'object' ? line as Record<string, unknown> : {};
    const sectionPath = Array.isArray(record.sectionPath)
      ? record.sectionPath.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const date = record.date == null ? null : String(record.date);
    const txnType = record.txnType == null ? null : String(record.txnType);
    const docNum = record.docNum == null ? null : String(record.docNum);
    const name = record.name == null ? null : String(record.name);
    const className = record.className == null ? null : String(record.className);
    const memo = record.memo == null ? null : String(record.memo);
    const splitAccount = record.splitAccount == null ? null : String(record.splitAccount);
    const amount = Number(record.amount || 0);

    return {
      id: `${date || 'no-date'}|${txnType || 'no-type'}|${docNum || 'no-doc'}|${name || 'no-name'}|${amount}|${index}`,
      sectionPath,
      date,
      txnType,
      docNum,
      name,
      className,
      memo,
      splitAccount,
      amount,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator.allowed) return administrator.response;

    const snapshotId = String(request.nextUrl.searchParams.get('snapshotId') || '').trim();
    const qboCustomerId = String(request.nextUrl.searchParams.get('qboCustomerId') || '').trim();
    if (!qboCustomerId) {
      return noStoreJson({ success: false, error: 'Missing required field: qboCustomerId' }, 400);
    }

    const snapshot = snapshotId
      ? await prisma.qboProfitabilitySnapshot.findUnique({
          where: { id: snapshotId },
          select: { id: true, startDate: true, endDate: true, accountingMethod: true },
        })
      : await prisma.qboProfitabilitySnapshot.findFirst({
          orderBy: { importedAt: 'desc' },
          select: { id: true, startDate: true, endDate: true, accountingMethod: true },
        });

    if (!snapshot) {
      return noStoreJson({ success: false, error: 'No profitability snapshot is available.' }, 404);
    }

    const qboRoot = resolveQboWorkspaceRoot();
    const reportBasename = `project-profitability-${toProjectDate(snapshot.startDate)}-to-${toProjectDate(snapshot.endDate)}`;
    const drillthroughPath = path.join(qboRoot, 'reports', `${reportBasename}-qbo-cost-lines.json`);
    const reportPath = path.join(qboRoot, 'reports', `${reportBasename}.json`);

    let projects: QboProjectDrillthrough[] = [];
    let sourcePath = '';

    if (await pathExists(drillthroughPath)) {
      const payload = await readJsonFile(drillthroughPath);
      sourcePath = drillthroughPath;
      projects = Array.isArray(payload.projects) ? payload.projects as QboProjectDrillthrough[] : [];
    } else if (await pathExists(reportPath)) {
      const payload = await readJsonFile(reportPath);
      sourcePath = reportPath;
      const drillthrough = payload.qboCostDrillthrough;
      projects = drillthrough && typeof drillthrough === 'object' && Array.isArray((drillthrough as Record<string, unknown>).projects)
        ? (drillthrough as Record<string, unknown>).projects as QboProjectDrillthrough[]
        : [];
    }

    const project = projects.find((entry) => String(entry.qboCustomerId || '') === qboCustomerId || String(entry.qboCostDrillthroughKey || '') === qboCustomerId);
    if (!project) {
      return noStoreJson({
        success: false,
        error: 'No QBO drill-through detail file is available for this snapshot yet.',
        details: {
          snapshotId: snapshot.id,
          reportBasename,
          sourcePath,
          hint: 'Run the profitability refresh after enabling QBO drill-through generation in QBO_1.',
        },
      }, 404);
    }

    const items = normalizeLines(project.lines).sort((left, right) => {
      const leftDate = left.date || '';
      const rightDate = right.date || '';
      return leftDate.localeCompare(rightDate)
        || String(left.txnType || '').localeCompare(String(right.txnType || ''))
        || String(left.docNum || '').localeCompare(String(right.docNum || ''));
    });

    const breakdown = Array.isArray(project.breakdown) && project.breakdown.length
      ? project.breakdown.map((entry) => ({ section: String(entry.section || 'Uncategorized'), amount: Number(entry.amount || 0) }))
      : [];

    return noStoreJson({
      success: true,
      snapshotId: snapshot.id,
      qboCustomerId,
      projectId: qboCustomerId,
      sourcePath,
      count: items.length,
      total: typeof project.total === 'number' ? project.total : null,
      breakdown,
      items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return noStoreJson({ success: false, error: 'Failed to load QBO drill-through details', details: message }, 500);
  }
}
