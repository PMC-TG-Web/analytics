export const COMMITMENT_MAKER_VENDOR_NAME = "Paradise Masonry, LLC";
export const COMMITMENT_MAKER_COST_TYPE = "O";

export type CommitmentMakerCell = string | number | boolean | null | undefined;

export type CommitmentMakerLineItem = {
  costCode: string;
  costType: typeof COMMITMENT_MAKER_COST_TYPE;
  description: string;
  quantity: number;
  uom: string;
  unitCost: number;
  subtotalOverride: null;
};

export type CommitmentMakerGroup = {
  name: string;
  lineItems: CommitmentMakerLineItem[];
};

export type CommitmentMakerParseResult = {
  headerRowIndex: number;
  groups: CommitmentMakerGroup[];
  sourceRowCount: number;
  skippedRows: number;
  warnings: string[];
};

const COLUMN_ALIASES = {
  costCode: ["Budget Code", "Cost Code"],
  description: ["Cost Catalog Item", "Description", "Cost item", "Cost Name"],
  quantity: ["Quantity", "Total Quantity"],
  uom: ["UoM (Quantity)", "UoM", "UOM", "Unit of Measure"],
  unitCost: ["Unit Cost", "Unit Price", "Total Cost"],
} as const;

function text(value: CommitmentMakerCell): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeHeader(value: CommitmentMakerCell): string {
  return text(value)
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaderIndex(headers: CommitmentMakerCell[], aliases: readonly string[]): number {
  const normalizedHeaders = headers.map((value) => text(value).toLowerCase());
  const normalizedAliases = aliases.map((value) => value.toLowerCase());

  for (const alias of normalizedAliases) {
    const exact = normalizedHeaders.findIndex((header) => header === alias);
    if (exact !== -1) return exact;
  }
  for (const alias of normalizedAliases) {
    const fuzzy = normalizedHeaders.findIndex((header) => header.includes(alias));
    if (fuzzy !== -1) return fuzzy;
  }
  return -1;
}

function findQuantityUomColumnIndex(headers: CommitmentMakerCell[]): number {
  const normalized = headers.map(normalizeHeader);
  const hasQuantity = (header: string) => header.includes("quantity") || header.includes("qty");
  const hasUom = (header: string) =>
    header.includes("uom") || header === "u m" || header.includes("unit of measure");

  let index = normalized.findIndex((header) =>
    ["uom quantity", "quantity uom", "uom qty", "qty uom"].includes(header)
  );
  if (index !== -1) return index;
  index = normalized.findIndex((header) => hasUom(header) && hasQuantity(header) && !header.includes("labor"));
  if (index !== -1) return index;
  index = normalized.findIndex(
    (header) => header.includes("unit of measure") && hasQuantity(header) && !header.includes("labor")
  );
  if (index !== -1) return index;
  index = normalized.findIndex(
    (header) => ["uom", "u m", "unit of measure"].includes(header) && !header.includes("labor")
  );
  if (index !== -1) return index;
  return normalized.findIndex((header) => hasUom(header) && !header.includes("labor"));
}

function findHeaderRowIndex(rows: CommitmentMakerCell[][]): number {
  let bestIndex = -1;
  let bestScore = 0;
  const inspectCount = Math.min(rows.length, 25);

  for (let index = 0; index < inspectCount; index += 1) {
    const headers = (rows[index] || []).map(normalizeHeader);
    let score = 0;
    if (headers.some((header) => header.includes("uom") || header === "u m" || header.includes("unit of measure"))) score += 4;
    if (headers.some((header) => header.includes("quantity") || header.includes("qty"))) score += 4;
    if (headers.some((header) => header.includes("description") || header.includes("cost catalog item") || header === "cost item" || header.includes("cost name"))) score += 3;
    if (headers.some((header) => header.includes("cost code") || header.includes("budget code"))) score += 3;
    if (headers.some((header) => header.includes("unit cost") || header.includes("unit price") || header.includes("total cost") || header.includes("subtotal item cost"))) score += 2;
    if (headers.some((header) => header.includes("cost type"))) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 8 ? bestIndex : -1;
}

function rowHasMixedMarker(row: CommitmentMakerCell[], preferredIndex: number): boolean {
  if (preferredIndex !== -1 && text(row[preferredIndex]).toLowerCase() === "mixed") return true;
  return row.some((value) => text(value).toLowerCase() === "mixed");
}

function parsePositiveNumber(value: CommitmentMakerCell): number | null {
  const parsed = Number.parseFloat(text(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function suffixDescription(description: string, originalBudgetCode: string): string {
  const upper = originalBudgetCode.toUpperCase();
  if (upper.includes("SOG")) return `${description} - SOG`;
  if (upper.includes("SITE")) return `${description} - Site`;
  if (upper.includes("WALL")) return `${description} - Wall`;
  if (upper.includes("FOUNDATION")) return `${description} - Foundation`;
  return description;
}

function normalizeUom(value: CommitmentMakerCell): string {
  const normalized = text(value).toLowerCase();
  if (normalized === "cu yd") return "cy";
  if (normalized === "sq ft") return "sf";
  return text(value);
}

function safeGroupName(value: CommitmentMakerCell, fallback: string): string {
  return text(value) || fallback;
}

/**
 * Ports the production converter's "New Commitment with Labor - Split by Groups"
 * transformation. The caller is responsible for turning an XLSX sheet into a
 * two-dimensional value array.
 */
export function parseCommitmentMakerRows(
  rows: CommitmentMakerCell[][],
  options: { fallbackGroupName?: string } = {}
): CommitmentMakerParseResult {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error("The selected sheet does not contain enough rows to import.");
  }

  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex === -1) {
    throw new Error("Could not find the estimate header row in the selected sheet.");
  }

  const headers = rows[headerRowIndex] || [];
  const uomMarkerIndex = findQuantityUomColumnIndex(headers);
  if (uomMarkerIndex === -1) {
    throw new Error("Could not find the UoM (Quantity) column.");
  }

  const indices = {
    costCode: findHeaderIndex(headers, COLUMN_ALIASES.costCode),
    description: findHeaderIndex(headers, COLUMN_ALIASES.description),
    quantity: findHeaderIndex(headers, COLUMN_ALIASES.quantity),
    uom: findHeaderIndex(headers, COLUMN_ALIASES.uom),
    unitCost: findHeaderIndex(headers, COLUMN_ALIASES.unitCost),
  };
  const missing = Object.entries(indices)
    .filter(([, index]) => index === -1)
    .map(([field]) => field);
  if (missing.length > 0) {
    throw new Error(`Missing required estimate column(s): ${missing.join(", ")}.`);
  }

  type RawGroup = { name: string; rows: CommitmentMakerCell[][] };
  const detectedGroups: RawGroup[] = [];
  let currentGroup: RawGroup | null = null;
  for (let index = headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (rowHasMixedMarker(row, uomMarkerIndex)) {
      if (currentGroup) detectedGroups.push(currentGroup);
      currentGroup = {
        name: safeGroupName(row[0], `Group ${detectedGroups.length + 1}`),
        rows: [],
      };
    } else if (currentGroup) {
      currentGroup.rows.push(row);
    }
  }
  if (currentGroup) detectedGroups.push(currentGroup);

  const fallbackGroupName = safeGroupName(options.fallbackGroupName, "All Items");
  if (detectedGroups.length === 0) {
    detectedGroups.push({ name: fallbackGroupName, rows: rows.slice(headerRowIndex + 1) });
  }

  // Repeated group headers become one PO because the title/business key is the group name.
  const mergedGroups = new Map<string, RawGroup>();
  for (const group of detectedGroups) {
    const key = group.name.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = mergedGroups.get(key);
    if (existing) existing.rows.push(...group.rows);
    else mergedGroups.set(key, { name: group.name, rows: [...group.rows] });
  }

  let skippedRows = 0;
  const warnings: string[] = [];
  const groups: CommitmentMakerGroup[] = [];
  for (const group of mergedGroups.values()) {
    const consolidated = new Map<string, CommitmentMakerLineItem>();
    for (const row of group.rows) {
      const originalBudgetCode = text(row[indices.costCode]);
      const costCode = originalBudgetCode.substring(0, 12).trim();
      let description = text(row[indices.description]);
      const quantity = parsePositiveNumber(row[indices.quantity]);
      let uom = normalizeUom(row[indices.uom]);
      const hourly = ["hr", "hrs", "hour", "hours"].includes(uom.toLowerCase());
      const management = `${description} ${originalBudgetCode}`.toLowerCase().includes("management");
      const unitCost = hourly ? 0 : parsePositiveNumber(row[indices.unitCost]);

      if (
        !costCode ||
        !description ||
        !quantity ||
        uom.toLowerCase() === "mixed" ||
        (hourly && management) ||
        (!hourly && unitCost === null) ||
        description.toLowerCase().includes("shop draw")
      ) {
        skippedRows += 1;
        continue;
      }

      if (hourly) uom = "hours";
      description = suffixDescription(description, originalBudgetCode);
      const key = `${costCode}|${description}`;
      const existing = consolidated.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        consolidated.set(key, {
          costCode,
          costType: COMMITMENT_MAKER_COST_TYPE,
          description,
          quantity,
          uom,
          unitCost: Math.round((unitCost || 0) * 100) / 100,
          subtotalOverride: null,
        });
      }
    }

    const lineItems = [...consolidated.values()];
    if (lineItems.length === 0) warnings.push(`Group "${group.name}" has no importable line items.`);
    groups.push({ name: group.name, lineItems });
  }

  if (groups.length === 0) throw new Error("No commitment groups were found in the selected sheet.");

  return {
    headerRowIndex,
    groups,
    sourceRowCount: Math.max(0, rows.length - headerRowIndex - 1),
    skippedRows,
    warnings,
  };
}

export function normalizeCommitmentMakerVendorName(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(limited liability company|llc|incorporated|inc|corporation|corp|company|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function commitmentMakerProjectIdFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const projectId = String(params.get("projectId") || params.get("project_id") || "").trim();
  return /^\d+$/.test(projectId) ? projectId : "";
}

export function planNextPurchaseOrderNumbers(existingNumbers: unknown[], count: number): string[] {
  const values = existingNumbers
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const numeric = values.filter((value) => /^\d+$/.test(value));
  let sequence = numeric;
  let prefix = "";

  // Preserve a consistent PO prefix (for example PO-001) when a project has no
  // plain-numeric PO sequence.
  if (sequence.length === 0) {
    const byPrefix = new Map<string, string[]>();
    for (const value of values) {
      const match = value.match(/^(.*?)(\d+)$/);
      if (!match) continue;
      byPrefix.set(match[1], [...(byPrefix.get(match[1]) || []), match[2]]);
    }
    const selected = [...byPrefix.entries()].sort(
      (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0])
    )[0];
    if (selected) {
      [prefix, sequence] = selected;
    }
  }

  const max = sequence.reduce((current, value) => Math.max(current, Number.parseInt(value, 10)), 0);
  const width = Math.max(3, ...sequence.map((value) => value.length));
  return Array.from({ length: Math.max(0, count) }, (_, index) =>
    `${prefix}${String(max + index + 1).padStart(width, "0")}`
  );
}
