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

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS procore_change_order_package_lines (
          id                    BIGSERIAL PRIMARY KEY,
          company_id            TEXT NOT NULL,
          project_id            TEXT NOT NULL,
          contract_id           TEXT NOT NULL,
          package_id            TEXT NOT NULL,
          line_item_id          TEXT NOT NULL,
          package_status        TEXT,
          description           TEXT,
          cost_code_id          TEXT,
          cost_code             TEXT,
          wbs_code              TEXT,
          line_item_type_code   TEXT,
          uom                   TEXT,
          quantity              NUMERIC(18,4),
          unit_cost             NUMERIC(18,4),
          amount                NUMERIC(18,4),
          labor_hours           NUMERIC(18,4),
          payload               JSONB NOT NULL,
          source_created_at     TIMESTAMPTZ,
          source_updated_at     TIMESTAMPTZ,
          synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (company_id, project_id, package_id, line_item_id)
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_co_package_lines_company_project
          ON procore_change_order_package_lines (company_id, project_id)
      `);

      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_co_package_lines_package
          ON procore_change_order_package_lines (package_id)
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

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

function getLineItemId(record: Record<string, unknown>, index: number): string {
  return firstText(record.id, record.line_item_id) ?? `position:${readText(record.position) ?? index + 1}`;
}

function isLaborLine(lineTypeCode: string | null, wbsCode: string | null): boolean {
  if (lineTypeCode?.trim().toUpperCase() === 'L') return true;
  return /(?:^|\.)L$/i.test(wbsCode?.trim() ?? '');
}

export async function upsertChangeOrderPackageLine(params: {
  companyId: string;
  projectId: string;
  contractId: string;
  packageId: string;
  packageStatus: string | null;
  record: Record<string, unknown>;
  index: number;
}): Promise<string> {
  const { companyId, projectId, contractId, packageId, packageStatus, record, index } = params;
  const costCodeObject = asObject(record.cost_code) ?? {};
  const budgetCodeObject = asObject(record.budget_code) ?? {};
  const lineItemTypeObject = asObject(record.line_item_type) ?? {};
  const lineItemId = getLineItemId(record, index);
  const costCode = firstText(
    costCodeObject.full_code,
    costCodeObject.code,
    budgetCodeObject.flat_code,
    record.cost_code
  );
  const wbsCode = firstText(record.wbs_code, budgetCodeObject.flat_code, costCode);
  const lineItemTypeCode = firstText(
    lineItemTypeObject.code,
    lineItemTypeObject.id,
    record.line_item_type_code,
    record.line_item_type
  );
  const quantity = readNumber(record.quantity);
  const laborHours = isLaborLine(lineItemTypeCode, wbsCode) ? quantity : null;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_change_order_package_lines (
        company_id, project_id, contract_id, package_id, line_item_id,
        package_status, description, cost_code_id, cost_code, wbs_code,
        line_item_type_code, uom, quantity, unit_cost, amount, labor_hours,
        payload, source_created_at, source_updated_at, synced_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17::jsonb, $18::timestamptz, $19::timestamptz,
        NOW(), NOW()
      )
      ON CONFLICT (company_id, project_id, package_id, line_item_id)
      DO UPDATE SET
        contract_id = EXCLUDED.contract_id,
        package_status = EXCLUDED.package_status,
        description = EXCLUDED.description,
        cost_code_id = EXCLUDED.cost_code_id,
        cost_code = EXCLUDED.cost_code,
        wbs_code = EXCLUDED.wbs_code,
        line_item_type_code = EXCLUDED.line_item_type_code,
        uom = EXCLUDED.uom,
        quantity = EXCLUDED.quantity,
        unit_cost = EXCLUDED.unit_cost,
        amount = EXCLUDED.amount,
        labor_hours = EXCLUDED.labor_hours,
        payload = EXCLUDED.payload,
        source_created_at = EXCLUDED.source_created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    projectId,
    contractId,
    packageId,
    lineItemId,
    packageStatus,
    firstText(record.description, record.name, record.title),
    firstText(costCodeObject.id, budgetCodeObject.cost_code_id),
    costCode,
    wbsCode,
    lineItemTypeCode,
    firstText(record.uom, asObject(record.unit_of_measure)?.name),
    quantity,
    readNumber(record.unit_cost),
    readNumber(record.amount ?? record.total_amount),
    laborHours,
    JSON.stringify(record),
    normalizeTimestamp(record.created_at),
    normalizeTimestamp(record.updated_at)
  );

  return lineItemId;
}

export async function reconcileChangeOrderPackageLines(params: {
  companyId: string;
  projectId: string;
  packageId: string;
  lineItemIds: string[];
}): Promise<void> {
  const { companyId, projectId, packageId, lineItemIds } = params;
  await prisma.$executeRawUnsafe(
    `
      DELETE FROM procore_change_order_package_lines
      WHERE company_id = $1
        AND project_id = $2
        AND package_id = $3
        AND NOT (line_item_id = ANY($4::text[]))
    `,
    companyId,
    projectId,
    packageId,
    lineItemIds
  );
}
