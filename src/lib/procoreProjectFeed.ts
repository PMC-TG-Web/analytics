import { prisma } from '@/lib/prisma';

export const CUSTOMER_CUSTOM_FIELD_ID = process.env.PROCORE_CUSTOMER_FIELD_ID || '598134325737314';
export const DEFAULT_INTERNAL_VENDOR_NAMES = [
  'paradise masonry, llc',
  'paradise concrete solutions',
  'mcdonnel consulting',
  'pmc procore direct costs',
];

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function ensureProcoreProjectFeedTable() {
  return;
}

export function isMeaningfulCustomer(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !['unknown', 'n/a', 'na', 'none'].includes(trimmed.toLowerCase());
}

export function getInternalVendorSet(): Set<string> {
  const configured = (process.env.PROCORE_INTERNAL_VENDOR_NAMES || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return new Set([...DEFAULT_INTERNAL_VENDOR_NAMES, ...configured]);
}

export function isInternalCustomerName(value: unknown, internalVendorSet = getInternalVendorSet()): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && internalVendorSet.has(normalized);
}

export function extractCustomerFromCustomFields(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object') return null;
  const entries: JsonObject[] = Array.isArray(customFields)
    ? customFields
        .map(asObject)
        .filter((value): value is JsonObject => Boolean(value))
    : Object.values(customFields as JsonObject)
        .map(asObject)
        .filter((value): value is JsonObject => Boolean(value));

  for (const field of entries) {
    const id = readString(field.id);
    const label = readString(field.label);
    const value = asObject(field.value);
    const valueLabel = readString(value?.label);
    const keyId = Object.entries(customFields as JsonObject).find(([, entry]) => entry === field)?.[0]?.match(/custom_field_(\d+)/)?.[1] || null;

    if ((String(id || '') === CUSTOMER_CUSTOM_FIELD_ID || keyId === CUSTOMER_CUSTOM_FIELD_ID) && isMeaningfulCustomer(valueLabel)) {
      return valueLabel.trim();
    }

    if (String(id || '') === CUSTOMER_CUSTOM_FIELD_ID && isMeaningfulCustomer(label)) {
      return label.trim();
    }
  }

  for (const field of entries) {
    const value = readString(field.value);
    const label = readString(field.label);
    const name = readString(field.name);
    const labelValue = readString(field.label_value);
    const valueObject = asObject(field.value);
    const nestedValueLabel = readString(valueObject?.label);

    if (isMeaningfulCustomer(nestedValueLabel)) {
      return nestedValueLabel.trim();
    }

    if (isMeaningfulCustomer(value) && [label, name].some((v) => String(v || '').toLowerCase() === 'customer')) {
      return value.trim();
    }

    if (isMeaningfulCustomer(labelValue)) {
      return labelValue.trim();
    }

    if (isMeaningfulCustomer(label) && String(label).toLowerCase() !== 'customer') {
      return label.trim();
    }
  }

  return null;
}

export async function upsertProcoreProjectFeed(params: {
  companyId: string;
  syncSource: string;
  externalId: string;
  procoreId?: string | null;
  projectNumber?: string | null;
  projectName: string;
  status?: string | null;
  customer?: string | null;
  customerSource?: string | null;
  officeName?: string | null;
  city?: string | null;
  stateCode?: string | null;
  countryCode?: string | null;
  stageName?: string | null;
  dueDate?: string | Date | null;
  createdOn?: string | Date | null;
  sourceId?: string | null;
  sourceName?: string | null;
  sourceCreatedBy?: string | null;
  sourceCreatedAt?: string | Date | null;
  lastModifiedAt?: string | Date | null;
  estimatedValue?: number | null;
  softDeleted?: boolean;
  payload: unknown;
}) {
  const {
    companyId,
    syncSource,
    externalId,
    procoreId,
    projectNumber,
    projectName,
    status,
    customer,
    customerSource,
    officeName,
    city,
    stateCode,
    countryCode,
    stageName,
    dueDate,
    createdOn,
    sourceId,
    sourceName,
    sourceCreatedBy,
    sourceCreatedAt,
    lastModifiedAt,
    estimatedValue,
    softDeleted,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_project_feed
        (
          company_id,
          sync_source,
          external_id,
          procore_id,
          project_number,
          project_name,
          status,
          customer,
          customer_source,
          office_name,
          city,
          state_code,
          country_code,
          stage_name,
          due_date,
          created_on,
          source_id,
          source_name,
          source_created_by,
          source_created_at,
          last_modified_at,
          estimated_value,
          soft_deleted,
          payload,
          synced_at,
          updated_at
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz, $16::timestamptz, $17, $18, $19, $20::timestamptz, $21::timestamptz, $22, $23, $24::jsonb, NOW(), NOW())
      ON CONFLICT (company_id, sync_source, external_id)
      DO UPDATE SET
        procore_id = EXCLUDED.procore_id,
        project_number = EXCLUDED.project_number,
        project_name = EXCLUDED.project_name,
        status = EXCLUDED.status,
        customer = EXCLUDED.customer,
        customer_source = EXCLUDED.customer_source,
        office_name = EXCLUDED.office_name,
        city = EXCLUDED.city,
        state_code = EXCLUDED.state_code,
        country_code = EXCLUDED.country_code,
        stage_name = EXCLUDED.stage_name,
        due_date = EXCLUDED.due_date,
        created_on = EXCLUDED.created_on,
        source_id = EXCLUDED.source_id,
        source_name = EXCLUDED.source_name,
        source_created_by = EXCLUDED.source_created_by,
        source_created_at = EXCLUDED.source_created_at,
        last_modified_at = EXCLUDED.last_modified_at,
        estimated_value = EXCLUDED.estimated_value,
        soft_deleted = EXCLUDED.soft_deleted,
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    syncSource,
    externalId,
    procoreId ?? null,
    projectNumber ?? null,
    projectName,
    status ?? null,
    customer ?? null,
    customerSource ?? null,
    officeName ?? null,
    city ?? null,
    stateCode ?? null,
    countryCode ?? null,
    stageName ?? null,
    normalizeTimestamp(dueDate),
    normalizeTimestamp(createdOn),
    sourceId ?? null,
    sourceName ?? null,
    sourceCreatedBy ?? null,
    normalizeTimestamp(sourceCreatedAt),
    normalizeTimestamp(lastModifiedAt),
    estimatedValue ?? null,
    softDeleted === true,
    JSON.stringify(payload)
  );
}
