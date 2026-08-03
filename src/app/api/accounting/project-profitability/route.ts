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
  const allowed = assigned.some((permission) => ['OWNER', 'ADMIN'].includes(permission.toUpperCase()));
  if (!allowed) return { allowed: false as const, response: noStoreJson({ error: 'Forbidden' }, 403) };
  return { allowed: true as const, email };
}

export async function GET(request: NextRequest) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator.allowed) return administrator.response;

    const requestedSnapshotId = String(request.nextUrl.searchParams.get('snapshotId') || '').trim();
    if (requestedSnapshotId.length > 128) {
      return noStoreJson({ error: 'Invalid snapshot ID' }, 400);
    }

    const snapshots = await prisma.qboProfitabilitySnapshot.findMany({
      orderBy: { importedAt: 'desc' },
      take: 24,
      select: {
        id: true,
        sourceGeneratedAt: true,
        startDate: true,
        endDate: true,
        accountingMethod: true,
        readOnly: true,
        summary: true,
        sourceCounts: true,
        importedAt: true,
        _count: { select: { rows: true } },
      },
    });

    const selected = requestedSnapshotId
      ? snapshots.find((snapshot) => snapshot.id === requestedSnapshotId)
      : snapshots[0];
    if (requestedSnapshotId && !selected) {
      return noStoreJson({ error: 'Snapshot not found' }, 404);
    }

    const rows = selected
      ? await prisma.qboProjectProfitabilityRow.findMany({
          where: { snapshotId: selected.id },
          orderBy: [{ sales: 'desc' }, { fullyQualifiedName: 'asc' }],
        })
      : [];

    return noStoreJson({
      success: true,
      selectedSnapshotId: selected?.id || null,
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        sourceGeneratedAt: snapshot.sourceGeneratedAt.toISOString(),
        startDate: snapshot.startDate.toISOString().slice(0, 10),
        endDate: snapshot.endDate.toISOString().slice(0, 10),
        accountingMethod: snapshot.accountingMethod,
        readOnly: snapshot.readOnly,
        summary: snapshot.summary,
        sourceCounts: snapshot.sourceCounts,
        importedAt: snapshot.importedAt.toISOString(),
        rowCount: snapshot._count.rows,
      })),
      rows: rows.map((row) => ({
        id: row.id,
        qboCustomerId: row.qboCustomerId,
        recordType: row.recordType,
        projectName: row.projectName,
        fullyQualifiedName: row.fullyQualifiedName,
        active: row.active,
        procoreProjectId: row.procoreProjectId,
        procoreProjectNumber: row.procoreProjectNumber,
        procoreProjectName: row.procoreProjectName,
        procoreMatchMethod: row.procoreMatchMethod,
        sales: Number(row.sales),
        costOfGoodsSold: Number(row.costOfGoodsSold),
        operatingExpenses: Number(row.operatingExpenses),
        otherIncome: Number(row.otherIncome),
        otherExpenses: Number(row.otherExpenses),
        actualCost: Number(row.actualCost),
        profit: Number(row.profit),
        marginPercent: row.marginPercent == null ? null : Number(row.marginPercent),
        reportedNetIncome: Number(row.reportedNetIncome),
        reconciliationDifference: Number(row.reconciliationDifference),
      })),
    });
  } catch (error) {
    console.error('Failed to load QBO project profitability:', error);
    return noStoreJson({ error: 'Failed to load QBO project profitability' }, 500);
  }
}
