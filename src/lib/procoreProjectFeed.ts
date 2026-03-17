import { prisma } from '@/lib/prisma';

export const CUSTOMER_CUSTOM_FIELD_ID = '598134331753944';

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
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_project_feed (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      sync_source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      procore_id TEXT NULL,
      project_number TEXT NULL,
      project_name TEXT NOT NULL,
      status TEXT NULL,
      customer TEXT NULL,
      customer_source TEXT NULL,
      office_name TEXT NULL,
      city TEXT NULL,
      state_code TEXT NULL,
      country_code TEXT NULL,
      stage_name TEXT NULL,
      due_date TIMESTAMPTZ NULL,
      created_on TIMESTAMPTZ NULL,
      source_id TEXT NULL,
      source_name TEXT NULL,
      source_created_by TEXT NULL,
      source_created_at TIMESTAMPTZ NULL,
      last_modified_at TIMESTAMPTZ NULL,
      estimated_value DOUBLE PRECISION NULL,
      linked_project_id TEXT NULL,
      match_confidence TEXT NULL,
      matched_at TIMESTAMPTZ NULL,
      soft_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB NOT NULL,
      UNIQUE(company_id, sync_source, external_id)
    )
  `);

  // Keep payload as the last physical column for easier table inspection in DB tools.
  await prisma.$executeRawUnsafe(`
    DO $$
    DECLARE
      payload_pos INTEGER;
      max_pos INTEGER;
    BEGIN
      SELECT ordinal_position
      INTO payload_pos
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'procore_project_feed'
        AND column_name = 'payload';

      SELECT MAX(ordinal_position)
      INTO max_pos
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'procore_project_feed';

      IF payload_pos IS NOT NULL AND max_pos IS NOT NULL AND payload_pos < max_pos THEN
        CREATE TABLE procore_project_feed_reordered (
          id BIGSERIAL PRIMARY KEY,
          company_id TEXT NOT NULL,
          sync_source TEXT NOT NULL,
          external_id TEXT NOT NULL,
          procore_id TEXT NULL,
          project_number TEXT NULL,
          project_name TEXT NOT NULL,
          status TEXT NULL,
          customer TEXT NULL,
          customer_source TEXT NULL,
          office_name TEXT NULL,
          city TEXT NULL,
          state_code TEXT NULL,
          country_code TEXT NULL,
          stage_name TEXT NULL,
          due_date TIMESTAMPTZ NULL,
          created_on TIMESTAMPTZ NULL,
          source_id TEXT NULL,
          source_name TEXT NULL,
          source_created_by TEXT NULL,
          source_created_at TIMESTAMPTZ NULL,
          last_modified_at TIMESTAMPTZ NULL,
          estimated_value DOUBLE PRECISION NULL,
          linked_project_id TEXT NULL,
          match_confidence TEXT NULL,
          matched_at TIMESTAMPTZ NULL,
          soft_deleted BOOLEAN NOT NULL DEFAULT FALSE,
          synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload JSONB NOT NULL,
          UNIQUE(company_id, sync_source, external_id)
        );

        INSERT INTO procore_project_feed_reordered (
          id,
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
          linked_project_id,
          match_confidence,
          matched_at,
          soft_deleted,
          synced_at,
          created_at,
          updated_at,
          payload
        )
        SELECT
          id,
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
          linked_project_id,
          match_confidence,
          matched_at,
          soft_deleted,
          synced_at,
          created_at,
          updated_at,
          payload
        FROM procore_project_feed;

        PERFORM setval(
          pg_get_serial_sequence('procore_project_feed_reordered', 'id'),
          GREATEST((SELECT COALESCE(MAX(id), 1) FROM procore_project_feed_reordered), 1),
          true
        );

        DROP TABLE procore_project_feed;
        ALTER TABLE procore_project_feed_reordered RENAME TO procore_project_feed;
      END IF;
    END
    $$;
  `);

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_company ON procore_project_feed(company_id)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_name ON procore_project_feed(project_name)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_customer ON procore_project_feed(customer)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_synced_at ON procore_project_feed(synced_at DESC)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_unmatched ON procore_project_feed(linked_project_id)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_soft_deleted ON procore_project_feed(soft_deleted)'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS office_name TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS city TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS state_code TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS country_code TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS stage_name TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS created_on TIMESTAMPTZ NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS source_id TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS source_name TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS source_created_by TEXT NULL'
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE procore_project_feed ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ NULL'
  );

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_office_name ON procore_project_feed(office_name)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_city ON procore_project_feed(city)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_state_code ON procore_project_feed(state_code)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_due_date ON procore_project_feed(due_date)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_created_on ON procore_project_feed(created_on)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_source_id ON procore_project_feed(source_id)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_source_created_by ON procore_project_feed(source_created_by)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_procore_project_feed_source_created_at ON procore_project_feed(source_created_at)'
  );
}

export function isMeaningfulCustomer(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !['unknown', 'n/a', 'na', 'none'].includes(trimmed.toLowerCase());
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
    if (String(id || '') === CUSTOMER_CUSTOM_FIELD_ID && isMeaningfulCustomer(label)) {
      return label.trim();
    }
  }

  for (const field of entries) {
    const value = readString(field.value);
    const label = readString(field.label);
    const name = readString(field.name);
    const labelValue = readString(field.label_value);

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
