export type ProductivityFingerprintInput = {
  date?: unknown;
  contractNumber?: unknown;
  lineItemDescription?: unknown;
  quantityDelivered?: unknown;
  quantityUsed?: unknown;
  notes?: unknown;
};

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizedText(value: unknown) {
  return text(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizedNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) ? String(parsed) : "";
}

export function normalizeProductivityDescription(value: unknown) {
  let description = text(value)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  description = description.replace(/^#\s*\d+\s*-\s*/i, "");
  description = description.replace(
    /\s*-\s*-?\d+(?:\.\d+)?\s*(?:ea|cy|sf|sq\s*ft|sq_ft|lf|ft|hr|hrs|hours|bag|bags|sheet|sheets|gal|gals|pc|pcs|day|days|month|months|ls)\s*$/i,
    ""
  );

  return normalizedText(description);
}

export function productivityCloneFingerprint(input: ProductivityFingerprintInput) {
  return [
    text(input.date).slice(0, 10),
    normalizedText(input.contractNumber),
    normalizeProductivityDescription(input.lineItemDescription),
    normalizedNumber(input.quantityDelivered),
    normalizedNumber(input.quantityUsed),
    normalizedText(input.notes),
  ].join("|");
}

export function countProductivityFingerprints(keys: string[]) {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function allocateExistingProductivityRows<
  T extends { sourceId: string; productivityFingerprint: string }
>(rows: T[], existingCounts: Map<string, number>, repairSourceIds: Set<string> = new Set()) {
  const remaining = new Map(existingCounts);
  const existingRows = new Set<T>();
  const allocationOrder = repairSourceIds.size > 0
    ? [
        ...rows.filter((row) => !repairSourceIds.has(row.sourceId)),
        ...rows.filter((row) => repairSourceIds.has(row.sourceId)),
      ]
    : rows;

  for (const row of allocationOrder) {
    const key = row.productivityFingerprint;
    const available = key ? remaining.get(key) || 0 : 0;
    if (available <= 0) continue;
    existingRows.add(row);
    remaining.set(key, available - 1);
  }

  return rows.map((row) => ({
    ...row,
    existingTargetProductivity: existingRows.has(row),
  }));
}
