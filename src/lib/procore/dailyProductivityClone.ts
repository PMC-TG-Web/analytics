export type ProductivityFingerprintInput = {
  date?: unknown;
  contractNumber?: unknown;
  lineItemDescription?: unknown;
  quantityDelivered?: unknown;
  quantityUsed?: unknown;
  notes?: unknown;
};

export function isBillingFileCommitment(input: {
  contractNumber?: unknown;
  contractTitle?: unknown;
}) {
  return [input.contractNumber, input.contractTitle]
    .map(normalizedText)
    .some((value) => /\bbilling[\s_-]*file\b/.test(value));
}

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

export type ExpectedQuantityCeilingRow = {
  sourceId: string;
  existingTargetProductivity: boolean;
  targetLineItem: {
    id: number;
    expectedQuantity?: number | null;
    enforceExpectedQuantityCeiling?: boolean;
  } | null;
  payload: {
    quantity_used?: unknown;
  };
};

export type ExpectedQuantityGuard = {
  blocked: boolean;
  expectedQuantity: number;
  usedBefore: number;
  requestedQuantity: number;
  remainingQuantity: number;
  reason: string | null;
};

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function guardExpectedProductivityQuantities<T extends ExpectedQuantityCeilingRow>(
  rows: T[],
  existingUsedByLineItem: Map<string, number>,
  tolerance = 0.005
) {
  const runningUsed = new Map(existingUsedByLineItem);

  return rows.map((row) => {
    const target = row.targetLineItem;
    const expectedQuantity = finiteNumber(target?.expectedQuantity);
    const requestedQuantity = finiteNumber(row.payload.quantity_used) ?? 0;
    const lineItemId = target ? String(target.id) : "";

    if (
      !target?.enforceExpectedQuantityCeiling ||
      expectedQuantity === null ||
      expectedQuantity <= tolerance ||
      !lineItemId ||
      requestedQuantity <= tolerance
    ) {
      return { ...row, expectedQuantityGuard: null as ExpectedQuantityGuard | null };
    }

    const usedBefore = Math.max(0, runningUsed.get(lineItemId) || 0);
    const remainingQuantity = Math.max(0, expectedQuantity - usedBefore);
    const blocked =
      !row.existingTargetProductivity &&
      requestedQuantity > remainingQuantity + tolerance;

    if (!row.existingTargetProductivity && !blocked) {
      runningUsed.set(lineItemId, usedBefore + requestedQuantity);
    }

    return {
      ...row,
      expectedQuantityGuard: {
        blocked,
        expectedQuantity,
        usedBefore,
        requestedQuantity,
        remainingQuantity,
        reason: blocked
          ? "Creating this forms log would exceed the purchase-order expected quantity."
          : null,
      } satisfies ExpectedQuantityGuard,
    };
  });
}
