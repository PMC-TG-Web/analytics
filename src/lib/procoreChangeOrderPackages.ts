import { prisma } from '@/lib/prisma';

function normalizeTimestamp(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSchemaPermissionDeniedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('permission denied for schema public') || message.includes('Code: `42501`');
}

let tableReady: Promise<void> | null = null;

export async function ensureChangeOrderPackagesTable(): Promise<void> {
  if (tableReady) return tableReady;

  tableReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS procore_change_order_packages (
          company_id            TEXT NOT NULL,
          project_id            TEXT NOT NULL,
          contract_id           TEXT NOT NULL,
          package_id            TEXT NOT NULL,
          number                TEXT,
          title                 TEXT,
          status                TEXT,
          description           TEXT,
          revision              TEXT,
          amount                NUMERIC,
          executed_on           TIMESTAMPTZ,
          source_created_at     TIMESTAMPTZ,
          source_updated_at     TIMESTAMPTZ,
          payload               JSONB NOT NULL,
          synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (company_id, project_id, package_id)
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS procore_cop_project_id_idx
          ON procore_change_order_packages (project_id)
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS procore_cop_status_idx
          ON procore_change_order_packages (status)
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS procore_cop_synced_at_idx
          ON procore_change_order_packages (synced_at DESC)
      `);
    } catch (err) {
      if (!isSchemaPermissionDeniedError(err)) {
        throw err;
      }

      // Production DB roles may not be able to CREATE; continue if table exists.
      await prisma.$queryRawUnsafe('SELECT 1 FROM procore_change_order_packages LIMIT 1');
    }
  })();

  return tableReady;
}

export async function upsertChangeOrderPackage(params: {
  companyId: string;
  projectId: string;
  contractId: string;
  record: Record<string, unknown>;
}): Promise<void> {
  const { companyId, projectId, contractId, record } = params;

  const packageId = readText(record.id);
  if (!packageId) return;

  const numberObj = asObject(record.number_object);
  const number = readText(record.number) ?? readText(numberObj?.value) ?? readText(record.package_number) ?? null;
  const title = readText(record.title) ?? readText(record.name) ?? null;
  const status = readText(record.status) ?? null;
  const description = readText(record.description) ?? null;
  const revision = readText(record.revision) ?? readText(record.revision_number) ?? null;
  const amount = readNumber(record.grand_total) ?? readNumber(record.amount) ?? null;
  const executedOn = normalizeTimestamp(record.executed_on ?? record.execution_date ?? null);
  const sourceCreatedAt = normalizeTimestamp(record.created_at ?? null);
  const sourceUpdatedAt = normalizeTimestamp(record.updated_at ?? null);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_change_order_packages (
        company_id, project_id, contract_id, package_id,
        number, title, status, description, revision, amount,
        executed_on, source_created_at, source_updated_at,
        payload, synced_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11::timestamptz, $12::timestamptz, $13::timestamptz,
              $14::jsonb, NOW())
      ON CONFLICT (company_id, project_id, package_id)
      DO UPDATE SET
        contract_id       = EXCLUDED.contract_id,
        number            = EXCLUDED.number,
        title             = EXCLUDED.title,
        status            = EXCLUDED.status,
        description       = EXCLUDED.description,
        revision          = EXCLUDED.revision,
        amount            = EXCLUDED.amount,
        executed_on       = EXCLUDED.executed_on,
        source_created_at = EXCLUDED.source_created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        payload           = EXCLUDED.payload,
        synced_at         = NOW()
    `,
    companyId,
    projectId,
    contractId,
    packageId,
    number,
    title,
    status,
    description,
    revision,
    amount,
    executedOn,
    sourceCreatedAt,
    sourceUpdatedAt,
    JSON.stringify(record)
  );
}
