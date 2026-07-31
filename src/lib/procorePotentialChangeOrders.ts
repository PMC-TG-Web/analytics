import { prisma } from "@/lib/prisma";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function timestamp(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function schemaPermissionDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("permission denied for schema public") || message.includes("Code: `42501`");
}

let tableReady: Promise<void> | null = null;

export async function ensurePotentialChangeOrderTables(): Promise<void> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS procore_potential_change_orders (
          company_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          change_order_id TEXT NOT NULL,
          contract_id TEXT,
          package_id TEXT,
          number TEXT,
          title TEXT,
          status TEXT,
          description TEXT,
          amount NUMERIC(18,4),
          source_created_at TIMESTAMPTZ,
          source_updated_at TIMESTAMPTZ,
          payload JSONB NOT NULL,
          synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (company_id, project_id, change_order_id)
        )
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS procore_potential_change_order_lines (
          id BIGSERIAL PRIMARY KEY,
          company_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          change_order_id TEXT NOT NULL,
          line_item_id TEXT NOT NULL,
          change_order_status TEXT,
          description TEXT,
          cost_code_id TEXT,
          cost_code TEXT,
          wbs_code TEXT,
          line_item_type_code TEXT,
          uom TEXT,
          quantity NUMERIC(18,4),
          unit_cost NUMERIC(18,4),
          amount NUMERIC(18,4),
          labor_hours NUMERIC(18,4),
          payload JSONB NOT NULL,
          source_created_at TIMESTAMPTZ,
          source_updated_at TIMESTAMPTZ,
          synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (company_id, project_id, change_order_id, line_item_id)
        )
      `);
    } catch (error) {
      if (!schemaPermissionDenied(error)) throw error;
      await prisma.$queryRawUnsafe("SELECT 1 FROM procore_potential_change_orders LIMIT 1");
    }
  })();
  return tableReady;
}

export async function upsertPotentialChangeOrder(params: {
  companyId: string;
  projectId: string;
  record: JsonObject;
}): Promise<string | null> {
  const { companyId, projectId, record } = params;
  const changeOrderId = readText(record.id);
  if (!changeOrderId) return null;

  const contract = asObject(record.contract) ?? asObject(record.prime_contract) ?? {};
  const changeOrderPackage = asObject(record.change_order_package)
    ?? asObject(record.prime_contract_change_order)
    ?? {};
  const numberObject = asObject(record.number_object) ?? {};
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_potential_change_orders (
        company_id, project_id, change_order_id, contract_id, package_id,
        number, title, status, description, amount,
        source_created_at, source_updated_at, payload, synced_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11::timestamptz, $12::timestamptz, $13::jsonb, NOW()
      )
      ON CONFLICT (company_id, project_id, change_order_id)
      DO UPDATE SET
        contract_id = EXCLUDED.contract_id,
        package_id = EXCLUDED.package_id,
        number = EXCLUDED.number,
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        description = EXCLUDED.description,
        amount = EXCLUDED.amount,
        source_created_at = EXCLUDED.source_created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    companyId,
    projectId,
    changeOrderId,
    firstText(record.contract_id, contract.id, record.prime_contract_id),
    firstText(
      record.change_order_package_id,
      record.prime_contract_change_order_id,
      changeOrderPackage.id,
    ),
    firstText(record.number, numberObject.value, record.package_number),
    firstText(record.title, record.name),
    firstText(record.status, record.state),
    readText(record.description),
    readNumber(record.grand_total ?? record.value ?? record.amount ?? record.total_amount ?? record.total),
    timestamp(record.created_at),
    timestamp(record.updated_at),
    JSON.stringify(record),
  );
  return changeOrderId;
}

function lineItemId(record: JsonObject, index: number): string {
  return firstText(record.id, record.line_item_id) ?? `position:${readText(record.position) ?? index + 1}`;
}

function isLabor(lineItemTypeCode: string | null, wbsCode: string | null): boolean {
  return lineItemTypeCode?.toUpperCase() === "L" || /(?:^|\.)L$/i.test(wbsCode ?? "");
}

export async function upsertPotentialChangeOrderLine(params: {
  companyId: string;
  projectId: string;
  changeOrderId: string;
  changeOrderStatus: string | null;
  record: JsonObject;
  index: number;
}): Promise<string> {
  const { companyId, projectId, changeOrderId, changeOrderStatus, record, index } = params;
  const costCode = asObject(record.cost_code) ?? {};
  const budgetCode = asObject(record.budget_code) ?? {};
  const wbsCode = asObject(record.wbs_code) ?? {};
  const lineType = asObject(record.line_item_type) ?? {};
  const id = lineItemId(record, index);
  const normalizedCostCode = firstText(
    costCode.full_code,
    costCode.code,
    budgetCode.cost_code,
    budgetCode.flat_code,
    record.cost_code,
  );
  const normalizedWbsCode = firstText(
    wbsCode.flat_code,
    record.wbs_code,
    budgetCode.flat_code,
    normalizedCostCode,
  );
  const lineItemTypeCode = firstText(
    lineType.code,
    lineType.id,
    record.line_item_type_code,
    record.line_item_type,
  );
  const quantity = readNumber(record.quantity);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_potential_change_order_lines (
        company_id, project_id, change_order_id, line_item_id,
        change_order_status, description, cost_code_id, cost_code, wbs_code,
        line_item_type_code, uom, quantity, unit_cost, amount, labor_hours,
        payload, source_created_at, source_updated_at, synced_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16::jsonb,
        $17::timestamptz, $18::timestamptz, NOW(), NOW()
      )
      ON CONFLICT (company_id, project_id, change_order_id, line_item_id)
      DO UPDATE SET
        change_order_status = EXCLUDED.change_order_status,
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
    changeOrderId,
    id,
    changeOrderStatus,
    firstText(record.description, record.name, record.title),
    firstText(costCode.id, budgetCode.cost_code_id),
    normalizedCostCode,
    normalizedWbsCode,
    lineItemTypeCode,
    firstText(record.uom, asObject(record.unit_of_measure)?.name),
    quantity,
    readNumber(record.unit_cost),
    readNumber(record.amount ?? record.total_amount ?? record.extended_amount),
    isLabor(lineItemTypeCode, normalizedWbsCode) ? quantity : null,
    JSON.stringify(record),
    timestamp(record.created_at),
    timestamp(record.updated_at),
  );
  return id;
}

export async function reconcilePotentialChangeOrderLines(params: {
  companyId: string;
  projectId: string;
  changeOrderId: string;
  lineItemIds: string[];
}): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
      DELETE FROM procore_potential_change_order_lines
      WHERE company_id = $1
        AND project_id = $2
        AND change_order_id = $3
        AND NOT (line_item_id = ANY($4::text[]))
    `,
    params.companyId,
    params.projectId,
    params.changeOrderId,
    params.lineItemIds,
  );
}

export async function reconcilePotentialChangeOrders(params: {
  companyId: string;
  projectId: string;
  changeOrderIds: string[];
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `
        DELETE FROM procore_potential_change_order_lines
        WHERE company_id = $1
          AND project_id = $2
          AND NOT (change_order_id = ANY($3::text[]))
      `,
      params.companyId,
      params.projectId,
      params.changeOrderIds,
    );
    await tx.$executeRawUnsafe(
      `
        DELETE FROM procore_potential_change_orders
        WHERE company_id = $1
          AND project_id = $2
          AND NOT (change_order_id = ANY($3::text[]))
      `,
      params.companyId,
      params.projectId,
      params.changeOrderIds,
    );
  });
}
