import type { BatchBudgetLineItem } from './procoreBudgetLineItems';

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

function first(...values: unknown[]): string | null {
  return values.map(text).find(Boolean) || null;
}

function number(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  throw new Error('Budget contains an invalid numeric value; the saved snapshot was preserved.');
}

function collection(response: unknown): JsonObject[] {
  const envelope = object(response);
  const rows = Array.isArray(response) ? response
    : Array.isArray(envelope?.data) ? envelope.data
      : Array.isArray(envelope?.results) ? envelope.results : null;
  if (!rows || rows.some(row => !object(row))) {
    throw new Error('Budget collection is malformed; the saved snapshot was preserved.');
  }
  return rows as JsonObject[];
}

/** Source IDs are scoped identities. Malformed or foreign rows cannot prove absence. */
export function normalizeBudgetLineItem(value: unknown, companyId: string, projectId: string): BatchBudgetLineItem {
  const item = object(value);
  if (!item) throw new Error('Budget line must be an object.');
  const id = first(item.id, item.budget_line_item_id);
  if (!id) throw new Error('Budget line has no source ID; collection is incomplete.');
  for (const [key, expected] of [['company_id', companyId], ['project_id', projectId]] as const) {
    if (item[key] !== undefined && text(item[key]) !== expected) {
      throw new Error(`Budget line ${id} has a mismatched ${key}.`);
    }
  }
  const costCode = object(item.cost_code), type = object(item.line_item_type);
  const wbs = object(item.wbs_code), currency = object(item.currency_configuration);
  return {
    projectId, budgetLineItemId: id,
    name: first(item.name, item.title),
    costCode: first(item.cost_code_string, wbs?.flat_code, costCode?.code, costCode?.name, item.cost_code),
    costCodeDescription: first(wbs?.description, costCode?.description),
    wbsCodeId: first(wbs?.id, item.wbs_code_id),
    lineItemType: first(type?.name, type?.id, item.line_item_type),
    uom: text(item.uom), quantity: number(item.quantity), unitCost: number(item.unit_cost),
    originalBudgetAmount: number(item.original_budget_amount),
    amount: number(item.amount) ?? number(item.budget_amount) ?? number(item.original_budget_amount),
    calculationStrategy: text(item.calculation_strategy),
    currencyIsoCode: first(currency?.currency_iso_code, item.currency_iso_code),
    sourceCreatedAt: text(item.created_at), sourceUpdatedAt: text(item.updated_at), payload: item,
  };
}

/** A short page is not completion. Only a valid empty terminal page proves the full ID set. */
export async function fetchBudgetSnapshot(params: {
  companyId: string;
  projectId: string;
  request: (endpoint: string) => Promise<unknown>;
  fetchAll?: boolean;
  perPage?: number;
  maxPages?: number;
}) {
  const { companyId, projectId, request, fetchAll = true, perPage = 100, maxPages = 100 } = params;
  if (!companyId.trim() || !projectId.trim()) throw new Error('Budget company and project IDs are required.');
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(perPage) || perPage < 1) {
    throw new Error('Budget pagination limits must be positive integers.');
  }
  const encoded = encodeURIComponent(projectId);
  const paths = [
    `/rest/v1.1/budget_line_items?project_id=${encoded}`,
    `/rest/v1.0/budget_line_items?project_id=${encoded}`,
    `/rest/v1.1/projects/${encoded}/budget_line_items`,
    `/rest/v1.0/projects/${encoded}/budget_line_items`,
  ];
  const items: BatchBudgetLineItem[] = [], seen = new Set<string>();
  let selected: string | null = null;
  for (let page = 1; page <= maxPages; page += 1) {
    let response: unknown;
    if (selected) {
      response = await request(`${selected}${selected.includes('?') ? '&' : '?'}page=${page}&per_page=${perPage}`);
    } else {
      for (let index = 0; index < paths.length; index += 1) {
        const candidate = paths[index];
        try {
          response = await request(`${candidate}${candidate.includes('?') ? '&' : '?'}page=${page}&per_page=${perPage}`);
          selected = candidate;
          break;
        } catch (error) {
          const status = Number((error as { status?: number })?.status || 0);
          // Compatibility discovery is confined to page one. Never bypass auth,
          // throttling, transport errors, or a failure later in a chosen resource.
          if (![400, 404, 405, 500].includes(status) || index === paths.length - 1) throw error;
        }
      }
    }
    const batch = collection(response);
    if (batch.length === 0) return { items, complete: true, pages: page, endpoint: selected! };
    for (const row of batch) {
      const normalized = normalizeBudgetLineItem(row, companyId, projectId);
      if (seen.has(normalized.budgetLineItemId)) {
        throw new Error(`Duplicate budget source ID ${normalized.budgetLineItemId}; collection may have shifted or repeated.`);
      }
      seen.add(normalized.budgetLineItemId);
      items.push(normalized);
    }
    if (!fetchAll) return { items, complete: false, pages: page, endpoint: selected! };
  }
  throw new Error('Budget pagination limit reached before an empty terminal page; saved snapshot preserved.');
}
