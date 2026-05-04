import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { makeRequest, getClientCredentialsToken, procoreConfig } from '@/lib/procore';
import {
  extractCustomerFromCustomFields,
  isMeaningfulCustomer,
  upsertProcoreProjectFeed,
} from '@/lib/procoreProjectFeed';
import { persistTimecardEntries, type ProcoreTimecardEntry } from '@/lib/procoreTimecardEntries';
import { persistProductivityLogs, type ProcoreLog } from '@/lib/procoreProductivity';
import { persistCommitmentContracts, type ProcoreCommitmentContract } from '@/lib/procoreCommitmentContracts';
import { refreshCommitmentsAggMaterializedView } from '@/lib/commitmentsAggMv';

const MAX_BATCH_SIZE = 100;

// ─── Helpers shared across handlers ─────────────────────────────────────────

type JsonObject = Record<string, unknown>;

function asObj(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function firstStr(...values: unknown[]): string | null {
  for (const v of values) {
    const s = readStr(v);
    if (s) return s;
  }
  return null;
}

function readNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function getServiceToken(): Promise<string> {
  return getClientCredentialsToken();
}

// ─── Projects handler ────────────────────────────────────────────────────────

async function handleProjectsEvent(event: {
  companyId: string | null;
  resourceId: string | null;
  eventType: string | null;
  payload: unknown;
}): Promise<void> {
  const companyId = (event.companyId || procoreConfig.companyId || '').trim();
  const resourceId = (event.resourceId || '').trim();

  if (!companyId) throw new Error('handleProjectsEvent: missing companyId');
  if (!resourceId) throw new Error('handleProjectsEvent: missing resourceId');

  // Soft-delete on delete events — no API fetch needed.
  if (event.eventType === 'delete') {
    // Set soft_deleted = true for all sync_source rows matching this project.
    await prisma.$executeRawUnsafe(
      `UPDATE procore_project_feed
          SET soft_deleted = TRUE, updated_at = NOW(), synced_at = NOW()
        WHERE company_id = $1
          AND (procore_id = $2 OR external_id = $2)
          AND soft_deleted = FALSE`,
      companyId,
      resourceId
    );
    return;
  }

  // create / update — fetch fresh detail from Procore.
  const token = await getServiceToken();
  let project: JsonObject | null = null;
  try {
    const endpoint = `/rest/v1.0/projects/${resourceId}?company_id=${companyId}`;
    const raw = await makeRequest(endpoint, token, undefined, companyId, [404]);
    project = asObj(raw);
  } catch {
    // If Procore returns 404 the project is gone — soft-delete it.
    await prisma.$executeRawUnsafe(
      `UPDATE procore_project_feed
          SET soft_deleted = TRUE, updated_at = NOW(), synced_at = NOW()
        WHERE company_id = $1
          AND (procore_id = $2 OR external_id = $2)
          AND soft_deleted = FALSE`,
      companyId,
      resourceId
    );
    return;
  }

  if (!project) return;

  // Resolve customer using the same logic as the bulk sync route.
  const company = asObj(project.company);
  const customFieldCustomer = extractCustomerFromCustomFields(project.custom_fields);
  let customer: string | null = null;
  let customerSource: string | null = null;

  if (isMeaningfulCustomer(customFieldCustomer)) {
    customer = customFieldCustomer;
    customerSource = 'custom_field';
  } else {
    const direct =
      readStr(project.customer_name) || readStr(company?.name) || null;
    if (isMeaningfulCustomer(direct)) {
      customer = direct;
      customerSource = 'project_field';
    }
  }

  await upsertProcoreProjectFeed({
    companyId,
    syncSource: 'procore_webhook',
    externalId: resourceId,
    procoreId: resourceId,
    projectNumber:
      readStr(project.project_number) ||
      (project.project_number ? String(project.project_number) : null),
    projectName:
      readStr(project.name) || readStr(project.display_name) || 'Untitled Procore Project',
    status:
      readStr(project.status) ||
      readStr(asObj(project.project_status)?.name) ||
      readStr(asObj(project.project_stage)?.name) ||
      null,
    customer,
    customerSource,
    officeName: firstStr(asObj(project.office)?.name, project.office_name),
    city: firstStr(project.city, asObj(project.address)?.city),
    stateCode: firstStr(
      project.state_code,
      project.state,
      asObj(project.address)?.state_code,
      asObj(project.address)?.state
    ),
    countryCode: firstStr(
      project.country_code,
      project.country,
      asObj(project.address)?.country_code,
      asObj(project.address)?.country
    ),
    stageName: firstStr(asObj(project.project_stage)?.name),
    dueDate: readStr(project.due_date),
    createdOn: firstStr(project.created_at, project.created_on),
    sourceId: firstStr(project.id, project.project_id),
    sourceName: firstStr(project.name, project.display_name),
    sourceCreatedBy: firstStr(
      asObj(project.created_by)?.name,
      asObj(project.created_by)?.email,
      project.created_by
    ),
    sourceCreatedAt: firstStr(project.created_at, project.created_on),
    lastModifiedAt: readStr(project.updated_at) || readStr(project.last_modified_at) || null,
    estimatedValue: readNum(project.value) ?? readNum(project.estimated_value),
    softDeleted: Boolean(project.deleted_at),
    payload: project,
  });
}

// ─── Timecards handler ───────────────────────────────────────────────────────

async function handleTimecardsEvent(event: {
  companyId: string | null;
  projectId: string | null;
  resourceId: string | null;
  eventType: string | null;
}): Promise<void> {
  const companyId = (event.companyId || procoreConfig.companyId || '').trim();
  const projectId = (event.projectId || '').trim();
  const resourceId = (event.resourceId || '').trim();

  if (!projectId) throw new Error('handleTimecardsEvent: missing projectId');
  if (!resourceId) throw new Error('handleTimecardsEvent: missing resourceId');

  if (event.eventType === 'delete') {
    await prisma.$executeRawUnsafe(
      `UPDATE "TimecardEntry"
          SET "procoreDeletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "procoreId" = $1
          AND "procoreProjectId" = $2
          AND "procoreDeletedAt" IS NULL`,
      resourceId,
      projectId
    );
    return;
  }

  const token = await getServiceToken();
  const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
  let entry: unknown;
  try {
    entry = await makeRequest(
      `/rest/v1.0/projects/${encodeURIComponent(projectId)}/timecard_entries/${encodeURIComponent(resourceId)}${qs}`,
      token,
      undefined,
      companyId || undefined,
      [404]
    );
  } catch {
    // 404 — entry deleted; soft-delete locally
    await prisma.$executeRawUnsafe(
      `UPDATE "TimecardEntry"
          SET "procoreDeletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "procoreId" = $1
          AND "procoreProjectId" = $2
          AND "procoreDeletedAt" IS NULL`,
      resourceId,
      projectId
    );
    return;
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;

  await persistTimecardEntries([entry as ProcoreTimecardEntry], {
    companyId: companyId || undefined,
    projectId,
  });
}

// ─── Productivity Logs handler ───────────────────────────────────────────────

async function handleProductivityEvent(event: {
  companyId: string | null;
  projectId: string | null;
  resourceId: string | null;
  eventType: string | null;
}): Promise<void> {
  const companyId = (event.companyId || procoreConfig.companyId || '').trim();
  const projectId = (event.projectId || '').trim();
  const resourceId = (event.resourceId || '').trim();

  if (!projectId) throw new Error('handleProductivityEvent: missing projectId');
  if (!resourceId) throw new Error('handleProductivityEvent: missing resourceId');

  if (event.eventType === 'delete') {
    await prisma.$executeRawUnsafe(
      `UPDATE "ProductivityLog"
          SET "procoreDeletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "procoreId" = $1
          AND "procoreProjectId" = $2
          AND "procoreDeletedAt" IS NULL`,
      resourceId,
      projectId
    );
    return;
  }

  const token = await getServiceToken();
  const qs = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
  let log: unknown;
  try {
    log = await makeRequest(
      `/rest/v1.0/projects/${encodeURIComponent(projectId)}/productivity_logs/${encodeURIComponent(resourceId)}${qs}`,
      token,
      undefined,
      companyId || undefined,
      [404]
    );
  } catch {
    await prisma.$executeRawUnsafe(
      `UPDATE "ProductivityLog"
          SET "procoreDeletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "procoreId" = $1
          AND "procoreProjectId" = $2
          AND "procoreDeletedAt" IS NULL`,
      resourceId,
      projectId
    );
    return;
  }

  if (!log || typeof log !== 'object' || Array.isArray(log)) return;

  await persistProductivityLogs([log as ProcoreLog], {
    companyId: companyId || undefined,
    projectId,
  });
}

// ─── Commitment Contracts handler ────────────────────────────────────────────

async function handleCommitmentsEvent(event: {
  companyId: string | null;
  projectId: string | null;
  resourceId: string | null;
  eventType: string | null;
}): Promise<void> {
  const companyId = (event.companyId || procoreConfig.companyId || '').trim();
  const projectId = (event.projectId || '').trim();
  const resourceId = (event.resourceId || '').trim();

  if (!companyId) throw new Error('handleCommitmentsEvent: missing companyId');
  if (!projectId) throw new Error('handleCommitmentsEvent: missing projectId');
  if (!resourceId) throw new Error('handleCommitmentsEvent: missing resourceId');

  if (event.eventType === 'delete') {
    await prisma.$executeRawUnsafe(
      `UPDATE "CommitmentContract"
          SET "procoreDeletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "procoreId" = $1
          AND "procoreProjectId" = $2
          AND "procoreDeletedAt" IS NULL`,
      resourceId,
      projectId
    );
    await refreshCommitmentsAggMaterializedView();
    return;
  }

  const token = await getServiceToken();
  let contract: unknown;
  try {
    contract = await makeRequest(
      `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/commitment_contracts/${encodeURIComponent(resourceId)}`,
      token,
      undefined,
      companyId,
      [404]
    );
  } catch {
    await prisma.$executeRawUnsafe(
      `UPDATE "CommitmentContract"
          SET "procoreDeletedAt" = NOW(), "updatedAt" = NOW()
        WHERE "procoreId" = $1
          AND "procoreProjectId" = $2
          AND "procoreDeletedAt" IS NULL`,
      resourceId,
      projectId
    );
    return;
  }

  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return;

  await persistCommitmentContracts([contract as ProcoreCommitmentContract], {
    companyId: companyId || undefined,
    projectId,
  });

  await refreshCommitmentsAggMaterializedView();
}

// ─── Event dispatch ──────────────────────────────────────────────────────────

async function processEvent(event: {
  companyId: string | null;
  projectId: string | null;
  resourceName: string | null;
  eventType: string | null;
  resourceId: string | null;
  payload: unknown;
}): Promise<void> {
  const resource = (event.resourceName || '').toLowerCase();

  if (resource === 'projects') {
    return handleProjectsEvent(event);
  }

  if (resource === 'timecard entries' || resource.includes('timecard')) {
    return handleTimecardsEvent(event);
  }

  if (resource === 'productivity logs' || resource === 'manpower logs' || resource.includes('productivity') || resource.includes('manpower')) {
    return handleProductivityEvent(event);
  }

  if (resource === 'commitment contracts' || resource === 'subcontracts' || resource.includes('commitment contract') || resource.includes('subcontract')) {
    return handleCommitmentsEvent(event);
  }

  // Other domains (change orders, etc.) will be added in subsequent phases.
  // Unrecognised resources are acknowledged so they are marked completed rather
  // than left to retry indefinitely.
}


function getSyncSecretFromRequest(request: NextRequest): string {
  const fromHeader = request.headers.get('x-sync-secret')?.trim();
  if (fromHeader) return fromHeader;

  const auth = request.headers.get('authorization')?.trim();
  if (!auth) return '';

  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || auth;
}

function hasValidSyncSecret(request: NextRequest): boolean {
  const expected = (process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || '').trim();
  if (!expected) return false;
  return getSyncSecretFromRequest(request) === expected;
}

function nextRetryDelayMs(attemptNumber: number): number {
  const baseMs = 1_000;
  const maxMs = 5 * 60 * 1000;
  return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attemptNumber - 1)));
}

export async function POST(request: NextRequest) {
  if (!hasValidSyncSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let requestedBatchSize = 25;
  try {
    const body = (await request.json().catch(() => ({}))) as { batchSize?: unknown };
    const parsed = Number.parseInt(String(body.batchSize ?? '25'), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      requestedBatchSize = parsed;
    }
  } catch {
    // Keep default batch size.
  }

  const batchSize = Math.min(MAX_BATCH_SIZE, requestedBatchSize);
  const workerId = `manual:${Date.now()}`;
  const now = new Date();

  const candidates = await prisma.procoreWebhookQueue.findMany({
    where: {
      status: 'pending',
      availableAt: { lte: now },
    },
    orderBy: { createdAt: 'asc' },
    include: { event: true },
    take: batchSize,
  });

  let claimed = 0;
  let processed = 0;
  let failed = 0;

  for (const queueItem of candidates) {
    const claimResult = await prisma.procoreWebhookQueue.updateMany({
      where: {
        id: queueItem.id,
        status: 'pending',
      },
      data: {
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: workerId,
        attempts: { increment: 1 },
      },
    });

    if (claimResult.count === 0) {
      continue;
    }

    claimed += 1;

    try {
      await processEvent({
        companyId: queueItem.event.companyId,
        projectId: queueItem.event.projectId,
        resourceName: queueItem.event.resourceName,
        eventType: queueItem.event.eventType,
        resourceId: queueItem.event.resourceId,
        payload: queueItem.event.payload,
      });

      await prisma.$transaction([
        prisma.procoreWebhookQueue.update({
          where: { id: queueItem.id },
          data: {
            status: 'completed',
            processedAt: new Date(),
            lastError: null,
          },
        }),
        prisma.procoreWebhookEvent.update({
          where: { id: queueItem.eventId },
          data: { processedAt: new Date() },
        }),
      ]);
      processed += 1;
    } catch (error) {
      const attempted = queueItem.attempts + 1;
      const shouldFailPermanently = attempted >= queueItem.maxAttempts;
      const nextAvailableAt = shouldFailPermanently
        ? queueItem.availableAt
        : new Date(Date.now() + nextRetryDelayMs(attempted));

      await prisma.procoreWebhookQueue.update({
        where: { id: queueItem.id },
        data: {
          status: shouldFailPermanently ? 'failed' : 'pending',
          availableAt: nextAvailableAt,
          lockedAt: null,
          lockedBy: null,
          lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown processing failure',
        },
      });

      failed += 1;
    }
  }

  return NextResponse.json({
    success: true,
    requestedBatchSize: batchSize,
    scanned: candidates.length,
    claimed,
    processed,
    failed,
  });
}
