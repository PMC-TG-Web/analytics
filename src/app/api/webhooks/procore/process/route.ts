import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  makeRequest,
  getClientCredentialsToken,
  procoreConfig,
  withProcoreLiveApiBypassForSyncSecret,
} from '@/lib/procore';
import { buildAllowedProcoreHostCandidates } from '@/lib/procoreHosts';
import {
  extractCustomerFromCustomFields,
  isMeaningfulCustomer,
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

function normalizeBidBoardStatus(status: string | null | undefined): string | null {
  const raw = String(status || '').trim();
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ');

  if (!normalized) return null;
  if (normalized === 'bid submitted' || normalized === 'bidding') return 'Bid Submitted';
  if (normalized === 'pre construction' || normalized === 'estimating') return 'Estimating';
  if (normalized === 'post construction' || normalized === 'complete') return 'Complete';
  if (normalized === 'active' || normalized === 'in progress' || normalized === 'course of construction') return 'In Progress';
  if (normalized === 'accepted') return 'Accepted';
  if (normalized === 'invitation' || normalized === 'invitations') return 'Invitations';
  if (normalized === 'lost') return 'Lost';
  if (normalized === 'to do' || normalized === 'todo') return 'To Do';

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function mapV1StatusToBidBoardStatus(status: string | null | undefined): string | null {
  return normalizeBidBoardStatus(status);
}

function unwrapBidBoardProjectPayload(payload: unknown): JsonObject | null {
  if (Array.isArray(payload)) {
    const first = payload.find((item) => asObj(item));
    return first ? asObj(first) : null;
  }

  const record = asObj(payload);
  if (!record) return null;

  const candidates = [record.data, record.project, record.bid_board_project, record.projects, record.bid_board_projects];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const first = candidate.find((item) => asObj(item));
      if (first) return asObj(first);
    }

    const nested = asObj(candidate);
    if (nested) return nested;
  }

  return record;
}

async function getServiceToken(): Promise<string> {
  return getClientCredentialsToken();
}

async function upsertCanonicalProjectFromWebhook(params: {
  procoreId: string;
  projectNumber: string | null;
  projectName: string;
  status: string | null;
  statusRaw: string | null;
  customer: string | null;
}): Promise<void> {
  const { procoreId, projectNumber, projectName, status, statusRaw, customer } = params;
  const bidBoardStatus = mapV1StatusToBidBoardStatus(status);
  const nowIso = new Date().toISOString();

  const matches = await prisma.project.findMany({
    where: {
      OR: [
        { procoreId },
        { customFields: { path: ['procoreId'], equals: procoreId } },
      ],
    },
    orderBy: [{ updatedAt: 'desc' }],
  });

  const existing = matches[0] ?? null;
  const duplicateMatches = matches.slice(1);

  // Keep one authoritative canonical row per Procore ID.
  for (const duplicate of duplicateMatches) {
    const duplicateCustomFields =
      duplicate.customFields && typeof duplicate.customFields === 'object' && !Array.isArray(duplicate.customFields)
        ? (duplicate.customFields as Record<string, unknown>)
        : {};

    await prisma.project.update({
      where: { id: duplicate.id },
      data: {
        projectArchived: true,
        procoreId: null,
        customFields: {
          ...duplicateCustomFields,
          mergedIntoProcoreId: procoreId,
          mergedBy: 'procore_webhook',
          mergedAt: nowIso,
        },
      },
    });
  }

  if (existing) {
    const existingCustomFields =
      existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
        ? (existing.customFields as Record<string, unknown>)
        : {};

    await prisma.project.update({
      where: { id: existing.id },
      data: {
        procoreId,
        projectNumber: existing.projectNumber || projectNumber,
        customer: isMeaningfulCustomer(customer) ? customer : (existing.customer || null),
        customerSource: isMeaningfulCustomer(customer) ? 'procore_webhook' : (existing.customerSource || null),
        status: bidBoardStatus || existing.status,
        statusSource: bidBoardStatus ? 'procore_v1_mapped' : existing.statusSource,
        customFields: {
          ...existingCustomFields,
          procoreId,
          customerLabel: isMeaningfulCustomer(customer)
            ? customer
            : ((existingCustomFields.customerLabel as string | null | undefined) || null),
          statusRaw,
          bidBoardStatus,
          statusSyncedAt: nowIso,
          syncedFrom: 'procore_webhook',
          syncedAt: nowIso,
        },
      },
    });
    return;
  }

  await prisma.project.create({
    data: {
      projectName,
      procoreId,
      projectNumber,
      customer: isMeaningfulCustomer(customer) ? customer : null,
      customerSource: isMeaningfulCustomer(customer) ? 'procore_webhook' : null,
      status: bidBoardStatus,
      statusSource: bidBoardStatus ? 'procore_v1_mapped' : null,
      customFields: {
        procoreId,
        customerLabel: isMeaningfulCustomer(customer) ? customer : null,
        statusRaw,
        bidBoardStatus,
        source: 'procore_webhook',
        syncedAt: nowIso,
      },
    },
  });
}

async function upsertV1StagingFromWebhook(params: {
  companyId: string;
  procoreProjectId: string;
  name: string;
  status: string | null;
  bidBoardStatus: string | null;
  customer: string | null;
  payload: unknown;
}): Promise<void> {
  const { companyId, procoreProjectId, name, status, bidBoardStatus, customer, payload } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_project_staging
        (source, company_id, external_id, procore_project_id, name, status, bid_board_status, customer, payload, synced_at)
      VALUES
        ('procore_v1_projects', $1, $2, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      ON CONFLICT (source, company_id, external_id)
      DO UPDATE SET
        procore_project_id = EXCLUDED.procore_project_id,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        bid_board_status = EXCLUDED.bid_board_status,
        customer = EXCLUDED.customer,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    companyId,
    procoreProjectId,
    name,
    status,
    bidBoardStatus,
    customer,
    JSON.stringify(payload)
  );
}

async function applyBidBoardStatusToV1Staging(params: {
  companyId: string;
  procoreProjectId?: string | null;
  bidBoardStatus?: string | null;
  bidBoardId?: string | null;
  bidBoardName?: string | null;
  customer?: string | null;
}) {
  const { companyId, procoreProjectId, bidBoardStatus, bidBoardId, bidBoardName, customer } = params;

  if (procoreProjectId) {
    const updatedById = await prisma.$executeRawUnsafe(
      `
        UPDATE procore_project_staging
        SET
          bid_board_status = $1,
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
            'bidBoardStatus', $1,
            'bidBoardExternalId', $2,
            'bidBoardSyncedAt', NOW()::text
          ),
          synced_at = NOW()
        WHERE source = 'procore_v1_projects'
          AND company_id = $3
          AND procore_project_id = $4
      `,
      bidBoardStatus ?? null,
      bidBoardId ?? null,
      companyId,
      procoreProjectId
    );

    if (updatedById > 0) return updatedById;
  }

  const normalizedName = String(bidBoardName || '').trim();
  if (!normalizedName) return 0;
  const normalizedCustomer = isMeaningfulCustomer(customer) ? String(customer).trim() : null;

  return prisma.$executeRawUnsafe(
    `
      WITH candidate AS (
        SELECT ctid
        FROM procore_project_staging
        WHERE source = 'procore_v1_projects'
          AND company_id = $3
          AND LOWER(BTRIM(COALESCE(name, ''))) = LOWER(BTRIM($4))
        ORDER BY
          CASE
            WHEN $5::text IS NOT NULL
              AND LOWER(BTRIM(COALESCE(customer, ''))) = LOWER(BTRIM($5::text))
            THEN 0 ELSE 1
          END,
          synced_at DESC
        LIMIT 1
      )
      UPDATE procore_project_staging s
      SET
        bid_board_status = $1,
        payload = COALESCE(s.payload, '{}'::jsonb) || jsonb_build_object(
          'bidBoardStatus', $1,
          'bidBoardExternalId', $2,
          'bidBoardSyncedAt', NOW()::text,
          'bidBoardMatchMode', 'name_fallback'
        ),
        synced_at = NOW()
      FROM candidate
      WHERE s.ctid = candidate.ctid
    `,
    bidBoardStatus ?? null,
    bidBoardId ?? null,
    companyId,
    normalizedName,
    normalizedCustomer
  );
}

async function upsertBidBoardLive(params: {
  companyId: string;
  bidBoardId: string;
  procoreProjectId?: string | null;
  name?: string | null;
  status?: string | null;
  statusRaw?: string | null;
  customer?: string | null;
  payload: unknown;
}) {
  const {
    companyId,
    bidBoardId,
    procoreProjectId,
    name,
    status,
    statusRaw,
    customer,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_bid_board_live
        (bid_board_id, company_id, procore_project_id, name, status, status_raw, customer, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      ON CONFLICT (bid_board_id)
      DO UPDATE SET
        company_id = EXCLUDED.company_id,
        procore_project_id = EXCLUDED.procore_project_id,
        name = COALESCE(EXCLUDED.name, procore_bid_board_live.name),
        status = EXCLUDED.status,
        status_raw = EXCLUDED.status_raw,
        customer = COALESCE(EXCLUDED.customer, procore_bid_board_live.customer),
        synced_at = NOW(),
        payload = EXCLUDED.payload
    `,
    bidBoardId,
    companyId,
    procoreProjectId ?? null,
    name ?? null,
    status ?? null,
    statusRaw ?? null,
    customer ?? null,
    JSON.stringify(payload)
  );
}

async function fetchBidBoardProjectById(params: {
  companyId: string;
  bidBoardId: string;
  token: string;
}): Promise<JsonObject | null> {
  const { companyId, bidBoardId, token } = params;
  const hostCandidates = buildAllowedProcoreHostCandidates({
    requestedOrigin: process.env.PROCORE_ESTIMATING_API_URL || 'https://api.procore.com',
    extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, 'https://api.procore.com'],
  });

  if (hostCandidates.error) {
    return null;
  }

  for (const host of hostCandidates.candidates) {
    const endpoint = `${host.replace(/\/$/, '')}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(bidBoardId)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Procore-Company-Id': companyId,
      },
    });

    if (!response.ok) {
      continue;
    }

    const data = await response.json().catch(() => null);
    const record = unwrapBidBoardProjectPayload(data);
    if (record) return record;
  }

  return null;
}

async function upsertCanonicalProjectFromBidBoardWebhook(params: {
  companyId: string;
  bidBoardId: string;
  procoreProjectId: string | null;
  projectName: string;
  status: string | null;
  statusRaw: string | null;
  customer: string | null;
}): Promise<void> {
  const { bidBoardId, procoreProjectId, projectName, status, statusRaw, customer } = params;
  const nowIso = new Date().toISOString();
  const bidBoardStatus = normalizeBidBoardStatus(status);

  const matches = await prisma.project.findMany({
    where: {
      OR: [
        { bidBoardId },
        { customFields: { path: ['bidBoardId'], equals: bidBoardId } },
        ...(procoreProjectId ? [{ procoreId: procoreProjectId }] : []),
        ...(procoreProjectId ? [{ customFields: { path: ['procoreId'], equals: procoreProjectId } }] : []),
      ],
    },
    orderBy: [{ updatedAt: 'desc' }],
  });

  const existing = matches[0] ?? null;
  const duplicateMatches = matches.slice(1);

  for (const duplicate of duplicateMatches) {
    const duplicateCustomFields =
      duplicate.customFields && typeof duplicate.customFields === 'object' && !Array.isArray(duplicate.customFields)
        ? (duplicate.customFields as Record<string, unknown>)
        : {};

    await prisma.project.update({
      where: { id: duplicate.id },
      data: {
        projectArchived: true,
        procoreId: null,
        bidBoardId: null,
        customFields: {
          ...duplicateCustomFields,
          mergedIntoProcoreId: procoreProjectId || bidBoardId,
          mergedBy: 'procore_webhook',
          mergedAt: nowIso,
        },
      },
    });
  }

  if (existing) {
    const existingCustomFields =
      existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
        ? (existing.customFields as Record<string, unknown>)
        : {};

    await prisma.project.update({
      where: { id: existing.id },
      data: {
        bidBoardId,
        procoreId: procoreProjectId || existing.procoreId,
        projectName: existing.projectName || projectName,
        customer: isMeaningfulCustomer(customer) ? customer : (existing.customer || null),
        customerSource: isMeaningfulCustomer(customer) ? 'procore_bid_board' : (existing.customerSource || null),
        status: bidBoardStatus || existing.status,
        statusSource: bidBoardStatus ? 'procore_bid_board' : existing.statusSource,
        customFields: {
          ...existingCustomFields,
          bidBoardId,
          procoreId: procoreProjectId || (existingCustomFields.procoreId as string | null | undefined),
          customerLabel: isMeaningfulCustomer(customer)
            ? customer
            : ((existingCustomFields.customerLabel as string | null | undefined) || null),
          bidBoardStatus,
          bidBoardStatusRaw: statusRaw,
          statusSyncedAt: nowIso,
          syncedFrom: 'procore_webhook',
          syncedAt: nowIso,
        },
      },
    });
    return;
  }

  await prisma.project.create({
    data: {
      projectName,
      bidBoardId,
      procoreId: procoreProjectId,
      customer: isMeaningfulCustomer(customer) ? customer : null,
      customerSource: isMeaningfulCustomer(customer) ? 'procore_bid_board' : null,
      status: bidBoardStatus,
      statusSource: bidBoardStatus ? 'procore_bid_board' : null,
      customFields: {
        bidBoardId,
        procoreId: procoreProjectId,
        bidBoardStatus,
        bidBoardStatusRaw: statusRaw,
        customerLabel: isMeaningfulCustomer(customer) ? customer : null,
        source: 'procore_webhook',
        syncedAt: nowIso,
      },
    },
  });
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

  const projectName =
    readStr(project.name) || readStr(project.display_name) || 'Untitled Procore Project';
  const procoreProjectId =
    readStr((project as Record<string, unknown>).id) ||
    ((project as Record<string, unknown>).id != null ? String((project as Record<string, unknown>).id) : resourceId);
  const displayName = readStr(project.display_name) || projectName;
  const projectOwnerTypeObj = asObj(project.project_owner_type);
  const projectOwnerType =
    readStr(projectOwnerTypeObj?.name) ||
    readStr(project.project_owner_type) ||
    null;
  const projectOwnerTypeId =
    readStr(projectOwnerTypeObj?.id) ||
    (projectOwnerTypeObj?.id != null ? String(projectOwnerTypeObj.id) : null);
  const procoreCreatedAt = readStr(project.created_at) || null;
  const procoreUpdatedAt = readStr(project.updated_at) || null;
  const status =
    readStr(project.status) ||
    readStr(asObj(project.project_status)?.name) ||
    readStr(asObj(project.project_stage)?.name) ||
    'Active';
  const statusRaw =
    readStr(project.status) ||
    readStr(asObj(project.project_status)?.name) ||
    readStr(asObj(project.project_stage)?.name) ||
    null;
  const bidBoardStatus = mapV1StatusToBidBoardStatus(status);

  await upsertCanonicalProjectFromWebhook({
    procoreId: resourceId,
    projectNumber:
      readStr(project.project_number) ||
      (project.project_number ? String(project.project_number) : null),
    projectName,
    status,
    statusRaw,
    customer,
  });

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_project_staging
        (
          source,
          company_id,
          external_id,
          procore_project_id,
          name,
          status,
          customer,
          payload,
          synced_at,
          project_id,
          display_name,
          project_number,
          project_owner_type,
          project_owner_type_id,
          procore_created_at,
          procore_updated_at,
          bid_board_status
        )
      VALUES
        (
          'procore_v1_projects',
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          NOW(),
          $8,
          $9,
          $10,
          $11,
          $12,
          $13::timestamptz,
          $14::timestamptz,
          $15
        )
      ON CONFLICT (source, company_id, external_id)
      DO UPDATE SET
        procore_project_id = EXCLUDED.procore_project_id,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        customer = COALESCE(EXCLUDED.customer, procore_project_staging.customer),
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        project_id = EXCLUDED.project_id,
        display_name = EXCLUDED.display_name,
        project_number = EXCLUDED.project_number,
        project_owner_type = EXCLUDED.project_owner_type,
        project_owner_type_id = EXCLUDED.project_owner_type_id,
        procore_created_at = COALESCE(EXCLUDED.procore_created_at, procore_project_staging.procore_created_at),
        procore_updated_at = COALESCE(EXCLUDED.procore_updated_at, procore_project_staging.procore_updated_at),
        bid_board_status = EXCLUDED.bid_board_status
    `,
    companyId,
    resourceId,
    procoreProjectId,
    projectName,
    status,
    customer,
    JSON.stringify(project),
    procoreProjectId,
    displayName,
    readStr(project.project_number) || (project.project_number != null ? String(project.project_number) : null),
    projectOwnerType,
    projectOwnerTypeId,
    procoreCreatedAt,
    procoreUpdatedAt,
    bidBoardStatus
  );

  if (bidBoardStatus) {
    const bidBoardId = `${companyId || 'company'}:${resourceId}`;
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO procore_bid_board_live
          (bid_board_id, company_id, procore_project_id, name, status, status_raw, customer, payload, synced_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
        ON CONFLICT (bid_board_id)
        DO UPDATE SET
          company_id = EXCLUDED.company_id,
          procore_project_id = EXCLUDED.procore_project_id,
          name = COALESCE(EXCLUDED.name, procore_bid_board_live.name),
          status = EXCLUDED.status,
          status_raw = EXCLUDED.status_raw,
          customer = COALESCE(EXCLUDED.customer, procore_bid_board_live.customer),
          synced_at = NOW(),
          payload = EXCLUDED.payload
      `,
      bidBoardId,
      companyId,
      resourceId,
      projectName,
      bidBoardStatus,
      statusRaw,
      customer,
      JSON.stringify(project)
    );
  }
}

async function handleBidBoardProjectsEvent(event: {
  companyId: string | null;
  resourceId: string | null;
  eventType: string | null;
  payload: unknown;
}): Promise<void> {
  const companyId = (event.companyId || procoreConfig.companyId || '').trim();
  if (!companyId) throw new Error('handleBidBoardProjectsEvent: missing companyId');

  const payloadRecord = unwrapBidBoardProjectPayload(event.payload) || asObj(event.payload);
  const resourceId = (
    event.resourceId ||
    firstStr(payloadRecord?.id, payloadRecord?.bid_board_project_id, payloadRecord?.project_id) ||
    ''
  ).trim();

  if (!resourceId) throw new Error('handleBidBoardProjectsEvent: missing resourceId');

  if (event.eventType === 'delete') {
    return;
  }

  const token = await getServiceToken();
  const freshProject = await fetchBidBoardProjectById({ companyId, bidBoardId: resourceId, token });
  const project = freshProject || payloadRecord;
  if (!project) return;

  const bidBoardId = firstStr(project.id, project.bid_board_project_id, resourceId) || resourceId;
  const procoreProjectId = firstStr(project.project_id, project.procore_project_id) || null;
  const projectName = firstStr(project.name, project.display_name, project.title) || 'Untitled Bid Board Project';
  const statusRaw =
    firstStr(
      project.status,
      asObj(project.status)?.name,
      asObj(project.bid_status)?.name,
      asObj(project.project_status)?.name
    ) || null;
  const bidBoardStatus = normalizeBidBoardStatus(statusRaw);

  let customer: string | null = null;
  const customFieldCustomer = extractCustomerFromCustomFields((project as JsonObject).custom_fields);
  if (isMeaningfulCustomer(customFieldCustomer)) {
    customer = customFieldCustomer;
  } else {
    const direct =
      firstStr(project.customer_name, project.client_name) ||
      firstStr(asObj(project.customer_company)?.name, asObj(project.company)?.name) ||
      null;
    if (isMeaningfulCustomer(direct)) {
      customer = direct;
    }
  }

  await upsertBidBoardLive({
    companyId,
    bidBoardId,
    procoreProjectId,
    name: projectName,
    status: bidBoardStatus,
    statusRaw,
    customer: isMeaningfulCustomer(customer) ? customer : null,
    payload: project,
  });

  await upsertCanonicalProjectFromBidBoardWebhook({
    companyId,
    bidBoardId,
    procoreProjectId,
    projectName,
    status: bidBoardStatus,
    statusRaw,
    customer,
  });

  const updatedStagingRows = await applyBidBoardStatusToV1Staging({
    companyId,
    procoreProjectId,
    bidBoardStatus,
    bidBoardId,
    bidBoardName: projectName,
    customer,
  });

  if (bidBoardStatus && updatedStagingRows === 0 && procoreProjectId) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE procore_project_staging
        SET bid_board_status = $1, synced_at = NOW()
        WHERE source = 'procore_v1_projects'
          AND company_id = $2
          AND procore_project_id = $3
      `,
      bidBoardStatus,
      companyId,
      procoreProjectId
    );
  }
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

export async function processEvent(event: {
  companyId: string | null;
  projectId: string | null;
  resourceName: string | null;
  eventType: string | null;
  resourceId: string | null;
  payload: unknown;
}): Promise<void> {
  const resource = (event.resourceName || '').toLowerCase();

  if (resource === 'projects' || resource === 'project') {
    return handleProjectsEvent(event);
  }

  if (resource.includes('bid board') || (resource.includes('estimating') && resource.includes('project'))) {
    return handleBidBoardProjectsEvent({
      companyId: event.companyId,
      resourceId: event.resourceId,
      eventType: event.eventType,
      payload: event.payload,
    });
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
  const expected = (process.env.PROCORE_SYNC_SECRET || '').trim();
  if (!expected) return false;
  return getSyncSecretFromRequest(request) === expected;
}

function nextRetryDelayMs(attemptNumber: number): number {
  const baseMs = 1_000;
  const maxMs = 5 * 60 * 1000;
  return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attemptNumber - 1)));
}

function getWebhookWorkKey(event: {
  companyId: string | null;
  projectId: string | null;
  resourceName: string | null;
  eventType: string | null;
  resourceId: string | null;
}) {
  const action = String(event.eventType || '').toLowerCase() === 'delete' ? 'delete' : 'upsert';
  return [
    String(event.companyId || '').toLowerCase(),
    String(event.projectId || '').toLowerCase(),
    String(event.resourceName || '').toLowerCase(),
    String(event.resourceId || '').toLowerCase(),
    action,
  ].join(':');
}

async function findRecentOrActiveSyncLog(windowMinutes: number) {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  return prisma.syncLog.findFirst({
    where: {
      startedAt: { gte: cutoff },
      OR: [
        { finishedAt: null },
        { finishedAt: { gte: cutoff } },
      ],
      triggeredBy: { in: ['cron', 'cron-background', 'manual'] },
    },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      startedAt: true,
      finishedAt: true,
      triggeredBy: true,
      success: true,
    },
  });
}

export async function POST(request: NextRequest) {
  if (!hasValidSyncSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
  const syncWindowMinutes = Math.max(
    1,
    Number.parseInt(process.env.WEBHOOK_SYNC_CONFLICT_WINDOW_MINUTES || '5', 10) || 5
  );
  const activeOrRecentSync = await findRecentOrActiveSyncLog(syncWindowMinutes);
  if (activeOrRecentSync) {
    return NextResponse.json({
      success: true,
      deferred: true,
      reason: 'full-sync-window',
      windowMinutes: syncWindowMinutes,
      syncLog: activeOrRecentSync,
      scanned: 0,
      claimed: 0,
      processed: 0,
      failed: 0,
      coalesced: 0,
      deferredDuplicates: 0,
    });
  }

  let requestedBatchSize = Number.parseInt(request.nextUrl.searchParams.get('batchSize') || '25', 10) || 25;
  let dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';
  try {
    const body = (await request.json().catch(() => ({}))) as { batchSize?: unknown; dryRun?: unknown };
    const parsed = Number.parseInt(String(body.batchSize ?? requestedBatchSize), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      requestedBatchSize = parsed;
    }
    dryRun = dryRun || body.dryRun === true;
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

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      requestedBatchSize: batchSize,
      scanned: candidates.length,
      claimed: 0,
      processed: 0,
      failed: 0,
      candidates: candidates.map((queueItem) => ({
        queueId: queueItem.id,
        eventId: queueItem.eventId,
        resourceName: queueItem.event.resourceName,
        eventType: queueItem.event.eventType,
        projectId: queueItem.event.projectId,
        resourceId: queueItem.event.resourceId,
        attempts: queueItem.attempts,
        availableAt: queueItem.availableAt,
      })),
    });
  }

  let claimed = 0;
  let processed = 0;
  let failed = 0;
  let coalesced = 0;
  let deferredDuplicates = 0;
  const completedWorkKeys = new Set<string>();
  const failedWorkKeys = new Map<string, string>();

  for (const queueItem of candidates) {
    const workKey = getWebhookWorkKey(queueItem.event);
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

    if (completedWorkKeys.has(workKey)) {
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
      coalesced += 1;
      continue;
    }

    const priorFailure = failedWorkKeys.get(workKey);
    if (priorFailure) {
      const attempted = queueItem.attempts + 1;
      const shouldFailPermanently = attempted >= queueItem.maxAttempts;
      await prisma.procoreWebhookQueue.update({
        where: { id: queueItem.id },
        data: {
          status: shouldFailPermanently ? 'failed' : 'pending',
          availableAt: shouldFailPermanently
            ? queueItem.availableAt
            : new Date(Date.now() + nextRetryDelayMs(attempted)),
          lockedAt: null,
          lockedBy: null,
          lastError: priorFailure,
        },
      });
      failed += 1;
      deferredDuplicates += 1;
      continue;
    }

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
      completedWorkKeys.add(workKey);
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
      failedWorkKeys.set(
        workKey,
        error instanceof Error ? error.message.slice(0, 1000) : 'Unknown processing failure'
      );
    }
  }

  return NextResponse.json({
    success: true,
    requestedBatchSize: batchSize,
    scanned: candidates.length,
    claimed,
    processed,
    failed,
    coalesced,
    deferredDuplicates,
  });
  });
}
