import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type JsonObject = Record<string, unknown>;
type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

let unpackedFieldsTableReady: Promise<void> | null = null;

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function ensureBudgetLineItemsTable() {
  return;
}

function readNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function walkPayload(value: JsonLike, path: string, output: Array<{ fieldPath: string; value: JsonLike }>) {
  output.push({ fieldPath: path, value });

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkPayload(item, `${path}[${index}]`, output);
    });
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walkPayload(child as JsonLike, `${path}.${key}`, output);
    }
  }
}

function classifyValue(value: JsonLike) {
  if (value === null) {
    return {
      valueType: 'null',
      valueText: null as string | null,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueJson: null,
    };
  }
  if (typeof value === 'string') {
    return {
      valueType: 'string',
      valueText: value,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueJson: value,
    };
  }
  if (typeof value === 'number') {
    return {
      valueType: 'number',
      valueText: String(value),
      valueNumber: Number.isFinite(value) ? value : null,
      valueBoolean: null as boolean | null,
      valueJson: value,
    };
  }
  if (typeof value === 'boolean') {
    return {
      valueType: 'boolean',
      valueText: value ? 'true' : 'false',
      valueNumber: null as number | null,
      valueBoolean: value,
      valueJson: value,
    };
  }

  return {
    valueType: Array.isArray(value) ? 'array' : 'object',
    valueText: JSON.stringify(value),
    valueNumber: null as number | null,
    valueBoolean: null as boolean | null,
    valueJson: value,
  };
}

async function ensureBudgetLineItemUnpackedFieldsTable() {
  if (unpackedFieldsTableReady) return unpackedFieldsTableReady;

  unpackedFieldsTableReady = (async () => {
    return;
  })();

  return unpackedFieldsTableReady;
}

async function syncUnpackedFieldsForBudgetLineItem(
  companyId: string,
  projectId: string,
  budgetLineItemId: string,
  payload: JsonObject
) {
  await ensureBudgetLineItemUnpackedFieldsTable();

  const flattened: Array<{ fieldPath: string; value: JsonLike }> = [];
  walkPayload(payload as JsonLike, '$', flattened);

  const rows = flattened.map(({ fieldPath, value }) => {
    const classified = classifyValue(value);
    return {
      field_path: fieldPath,
      value_type: classified.valueType,
      value_text: classified.valueText,
      value_number: classified.valueNumber,
      value_boolean: classified.valueBoolean,
      value_json: classified.valueJson,
    };
  });

  await prisma.$executeRawUnsafe(
    `
      DELETE FROM budgetlineitem_unpacked_fields
      WHERE company_id = $1
        AND project_id = $2
        AND budget_line_item_id = $3
    `,
    companyId,
    projectId,
    budgetLineItemId
  );

  if (!rows.length) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO budgetlineitem_unpacked_fields (
        company_id,
        project_id,
        budget_line_item_id,
        field_path,
        value_type,
        value_text,
        value_number,
        value_boolean,
        value_json,
        updated_at
      )
      SELECT
        $1,
        $2,
        $3,
        row_data.field_path,
        row_data.value_type,
        row_data.value_text,
        row_data.value_number,
        row_data.value_boolean,
        COALESCE(row_data.value_json, 'null'::jsonb),
        NOW()
      FROM jsonb_to_recordset($4::jsonb) AS row_data(
        field_path TEXT,
        value_type TEXT,
        value_text TEXT,
        value_number DOUBLE PRECISION,
        value_boolean BOOLEAN,
        value_json JSONB
      )
      ON CONFLICT (company_id, project_id, budget_line_item_id, field_path)
      DO UPDATE SET
        value_type = EXCLUDED.value_type,
        value_text = EXCLUDED.value_text,
        value_number = EXCLUDED.value_number,
        value_boolean = EXCLUDED.value_boolean,
        value_json = COALESCE(EXCLUDED.value_json, 'null'::jsonb),
        updated_at = NOW()
    `,
    companyId,
    projectId,
    budgetLineItemId,
    JSON.stringify(rows)
  );
}

export async function upsertBudgetLineItem(params: {
  companyId: string;
  projectId: string;
  budgetLineItemId: string;
  name?: string | null;
  costCode?: string | null;
  costCodeDescription?: string | null;
  wbsCodeId?: string | null;
  lineItemType?: string | null;
  uom?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  originalBudgetAmount?: number | null;
  amount?: number | null;
  calculationStrategy?: string | null;
  currencyIsoCode?: string | null;
  sourceCreatedAt?: string | Date | null;
  sourceUpdatedAt?: string | Date | null;
  payload: JsonObject;
}) {
  const { companyId, ...item } = params;
  await batchUpsertBudgetLineItems(companyId, [item]);
  await syncUnpackedFieldsForBudgetLineItem(companyId, item.projectId, item.budgetLineItemId, item.payload);
}

export type BatchBudgetLineItem = {
  projectId: string;
  budgetLineItemId: string;
  name?: string | null;
  costCode?: string | null;
  costCodeDescription?: string | null;
  wbsCodeId?: string | null;
  lineItemType?: string | null;
  uom?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  originalBudgetAmount?: number | null;
  amount?: number | null;
  calculationStrategy?: string | null;
  currencyIsoCode?: string | null;
  sourceCreatedAt?: string | Date | null;
  sourceUpdatedAt?: string | Date | null;
  payload: JsonObject;
};

async function writeBudgetLineItems(
  tx: Prisma.TransactionClient,
  companyId: string,
  items: BatchBudgetLineItem[]
): Promise<number> {
  if (items.length === 0) return 0;

  const records = items.map((item) => ({
    company_id: companyId,
    project_id: item.projectId,
    budget_line_item_id: item.budgetLineItemId,
    name: item.name ?? null,
    cost_code: item.costCode ?? null,
    cost_code_description: item.costCodeDescription ?? null,
    wbs_code_id: item.wbsCodeId ?? null,
    line_item_type: item.lineItemType ?? null,
    uom: item.uom ?? null,
    quantity: (typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : readNum(item.quantity)) ?? null,
    unit_cost: (typeof item.unitCost === 'number' && Number.isFinite(item.unitCost) ? item.unitCost : readNum(item.unitCost)) ?? null,
    original_budget_amount: (typeof item.originalBudgetAmount === 'number' && Number.isFinite(item.originalBudgetAmount) ? item.originalBudgetAmount : readNum(item.originalBudgetAmount)) ?? null,
    amount: (typeof item.amount === 'number' && Number.isFinite(item.amount) ? item.amount : readNum(item.amount)) ?? null,
    calculation_strategy: item.calculationStrategy ?? null,
    currency_iso_code: item.currencyIsoCode ?? null,
    source_created_at: normalizeTimestamp(item.sourceCreatedAt),
    source_updated_at: normalizeTimestamp(item.sourceUpdatedAt),
    payload: JSON.stringify(item.payload),
  }));

  await tx.$executeRawUnsafe(
    `
      INSERT INTO budgetlineitems (
        company_id,
        project_id,
        budget_line_item_id,
        name,
        cost_code,
        cost_code_description,
        wbs_code_id,
        line_item_type,
        uom,
        quantity,
        unit_cost,
        original_budget_amount,
        amount,
        calculation_strategy,
        currency_iso_code,
        source_created_at,
        source_updated_at,
        payload,
        synced_at,
        updated_at
      )
      SELECT
        t.company_id,
        t.project_id,
        t.budget_line_item_id,
        t.name,
        t.cost_code,
        t.cost_code_description,
        t.wbs_code_id,
        t.line_item_type,
        t.uom,
        t.quantity::numeric,
        t.unit_cost::numeric,
        t.original_budget_amount::numeric,
        t.amount::numeric,
        t.calculation_strategy,
        t.currency_iso_code,
        t.source_created_at::timestamptz,
        t.source_updated_at::timestamptz,
        t.payload::jsonb,
        clock_timestamp(),
        clock_timestamp()
      FROM jsonb_to_recordset($1::jsonb) AS t(
        company_id TEXT,
        project_id TEXT,
        budget_line_item_id TEXT,
        name TEXT,
        cost_code TEXT,
        cost_code_description TEXT,
        wbs_code_id TEXT,
        line_item_type TEXT,
        uom TEXT,
        quantity TEXT,
        unit_cost TEXT,
        original_budget_amount TEXT,
        amount TEXT,
        calculation_strategy TEXT,
        currency_iso_code TEXT,
        source_created_at TEXT,
        source_updated_at TEXT,
        payload TEXT
      )
      ON CONFLICT (company_id, project_id, budget_line_item_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        cost_code = EXCLUDED.cost_code,
        cost_code_description = EXCLUDED.cost_code_description,
        wbs_code_id = EXCLUDED.wbs_code_id,
        line_item_type = EXCLUDED.line_item_type,
        uom = EXCLUDED.uom,
        quantity = EXCLUDED.quantity,
        unit_cost = EXCLUDED.unit_cost,
        original_budget_amount = EXCLUDED.original_budget_amount,
        amount = EXCLUDED.amount,
        calculation_strategy = EXCLUDED.calculation_strategy,
        currency_iso_code = EXCLUDED.currency_iso_code,
        source_created_at = EXCLUDED.source_created_at,
        source_updated_at = EXCLUDED.source_updated_at,
        payload = EXCLUDED.payload,
        source_missing_at = NULL,
        synced_at = clock_timestamp(),
        updated_at = clock_timestamp()
    `,
    JSON.stringify(records)
  );

  return items.length;
}

/** Capture database time before the first request in a project snapshot. */
export async function startBudgetSnapshot(): Promise<Date> {
  const rows = await prisma.$queryRawUnsafe<Array<{ started_at: Date }>>(
    'SELECT clock_timestamp() AS started_at',
  );
  const startedAt = rows[0]?.started_at;
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
    throw new Error('Could not establish the budget snapshot start time.');
  }
  return startedAt;
}

type BudgetSnapshotParams = {
  companyId: string;
  projectId: string;
  items: BatchBudgetLineItem[];
  startedAt: Date;
  complete: boolean;
  reconcileAbsent: boolean;
};

/** Persist one proven source scope atomically; retain absent rows as evidence. */
export async function persistBudgetSnapshot(params: BudgetSnapshotParams): Promise<{
  upserted: number;
  missing: number;
  reconciled: boolean;
  complete: boolean;
}> {
  const companyId = params.companyId.trim();
  const projectId = params.projectId.trim();
  if (!companyId || !projectId) throw new Error('Budget snapshot requires an explicit company and project.');
  if (!(params.startedAt instanceof Date) || !Number.isFinite(params.startedAt.getTime())) {
    throw new Error('Budget snapshot requires a valid database start time.');
  }
  if (params.reconcileAbsent && !params.complete) {
    throw new Error('An incomplete budget snapshot cannot reconcile absent rows.');
  }
  const ids = new Set<string>();
  const items = params.items.map((item) => {
    const id = item.budgetLineItemId.trim();
    if (item.projectId.trim() !== projectId || !id) {
      throw new Error('Budget snapshot contains a missing line ID or a different project.');
    }
    if (ids.has(id)) throw new Error('Budget snapshot contains duplicate source line IDs.');
    ids.add(id);
    return { ...item, projectId, budgetLineItemId: id };
  });

  // Production Accelerate rejects timeout options above its 15-second limit.
  return prisma.$transaction(async (tx) => {
    // A project lock also fences an initially empty scope without a row to lock.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `budget:${companyId}:${projectId}`,
    );
    const rows = await tx.$queryRawUnsafe<Array<{
      superseded: boolean;
      active_count: number;
    }>>(
      `
        SELECT
          COALESCE((SELECT last_write_at > $3::timestamptz FROM procore_budget_snapshot_states
                    WHERE company_id = $1 AND project_id = $2), FALSE)
            OR COALESCE(MAX(GREATEST(synced_at, updated_at)) > $3::timestamptz, FALSE) AS superseded,
          COUNT(*) FILTER (WHERE source_missing_at IS NULL)::integer AS active_count
        FROM budgetlineitems
        WHERE company_id = $1 AND project_id = $2
      `,
      companyId,
      projectId,
      params.startedAt,
    );
    const existing = rows[0];
    if (!existing) throw new Error('Could not verify the existing budget snapshot.');
    // Compare in PostgreSQL so a newer write within the same millisecond cannot
    // disappear when its microsecond timestamp is converted to a JavaScript Date.
    if (existing.superseded) {
      throw new Error('Budget snapshot was superseded by a newer write; fetch a fresh snapshot.');
    }
    if (params.complete && items.length === 0 && existing.active_count > 0) {
      throw new Error('An unexpectedly empty budget snapshot cannot replace existing active rows.');
    }

    const upserted = await writeBudgetLineItems(tx, companyId, items);
    const reconciled = params.complete && params.reconcileAbsent;
    const missing = reconciled ? await tx.$executeRawUnsafe(
      `
        UPDATE budgetlineitems
        SET source_missing_at = clock_timestamp(), synced_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE company_id = $1 AND project_id = $2
          AND source_missing_at IS NULL
          AND NOT (budget_line_item_id = ANY($3::text[]))
      `,
      companyId,
      projectId,
      [...ids],
    ) : 0;
    // Record even an initially empty completed snapshot. Row timestamps alone
    // cannot prevent an older concurrent read from filling that empty scope.
    await tx.$executeRawUnsafe(
      `
        INSERT INTO procore_budget_snapshot_states (
          company_id, project_id, last_write_at, last_complete_at, last_snapshot_started_at, source_count
        ) VALUES (
          $1, $2, clock_timestamp(), CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,
          $3::timestamptz, CASE WHEN $4 THEN $5::integer ELSE NULL END
        )
        ON CONFLICT (company_id, project_id) DO UPDATE SET
          last_write_at = clock_timestamp(),
          last_snapshot_started_at = EXCLUDED.last_snapshot_started_at,
          last_complete_at = CASE WHEN $4 THEN EXCLUDED.last_complete_at ELSE procore_budget_snapshot_states.last_complete_at END,
          source_count = CASE WHEN $4 THEN EXCLUDED.source_count ELSE procore_budget_snapshot_states.source_count END
      `,
      companyId,
      projectId,
      params.startedAt,
      reconciled,
      items.length,
    );
    return { upserted, missing, reconciled, complete: params.complete };
  }, { timeout: 15_000, maxWait: 10_000 });
}

/** Compatibility imports remain partial and never infer deletion from absence. */
export async function batchUpsertBudgetLineItems(companyId: string, items: BatchBudgetLineItem[]): Promise<number> {
  const projects = new Map<string, BatchBudgetLineItem[]>();
  for (const item of items) {
    const projectId = item.projectId.trim();
    const rows = projects.get(projectId) || [];
    rows.push(item);
    projects.set(projectId, rows);
  }
  let upserted = 0;
  for (const [projectId, projectItems] of projects) {
    const startedAt = await startBudgetSnapshot();
    const result = await persistBudgetSnapshot({ companyId, projectId, items: projectItems, startedAt, complete: false, reconcileAbsent: false });
    upserted += result.upserted;
  }
  return upserted;
}
