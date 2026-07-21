export const FORMS_CLOSEOUT_MARKER = "[PMC AUTO FORMS CLOSEOUT]";

export const FORMS_COST_CODES = [
  "03-100-10-20",
  "03-100-20-20",
  "03-100-30-20",
] as const;

const FORM_DESCRIPTION_PATTERN = /\bforms?\b|\bforming\b|\bformwork\b/i;
const FORM_EXCLUSION_PATTERN = /\bform\s*release\b|\brelease\s+(?:agent|oil)\b|\bform\s*oil\b/i;
const SF_UOMS = new Set(["SF", "SQ FT", "SQFT", "SQUARE FEET", "SQUARE FOOT"]);

export type FormsCloseoutDisposition = "ready" | "review" | "complete" | "seeded";

export type FormsCloseoutInput = {
  poStatus?: string | null;
  costCode?: string | null;
  description?: string | null;
  uom?: string | null;
  expectedQuantity?: number | null;
  usedQuantity?: number | null;
  seeded?: boolean;
};

export type FormsCloseoutClassification = {
  disposition: FormsCloseoutDisposition;
  reason: string;
  remainingQuantity: number;
  normalizedCostCode: string;
  normalizedUom: string;
};

export function normalizeFormsCostCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\.(?:L|M|S|O)$/i, "");
}

export function normalizeFormsUom(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function hasFormsCloseoutMarker(notes: unknown): boolean {
  return String(notes ?? "").toUpperCase().includes(FORMS_CLOSEOUT_MARKER);
}

export function formsCloseoutMarker(lineItemId: string): string {
  return `${FORMS_CLOSEOUT_MARKER} line_item_id=${lineItemId}`;
}

export function classifyFormsCloseoutLine(
  input: FormsCloseoutInput,
  tolerance = 0.005
): FormsCloseoutClassification {
  const normalizedCostCode = normalizeFormsCostCode(input.costCode);
  const normalizedUom = normalizeFormsUom(input.uom);
  const expected = Number(input.expectedQuantity ?? 0);
  const used = Number(input.usedQuantity ?? 0);
  const remainingQuantity = Number.isFinite(expected) && Number.isFinite(used)
    ? expected - used
    : 0;
  const description = String(input.description ?? "").trim();
  const approved = String(input.poStatus ?? "").trim().toLowerCase() === "approved";

  if (input.seeded) {
    return { disposition: "seeded", reason: "A forms closeout log has already been recorded.", remainingQuantity, normalizedCostCode, normalizedUom };
  }
  if (!approved) {
    return { disposition: "review", reason: "The purchase order is not approved.", remainingQuantity, normalizedCostCode, normalizedUom };
  }
  if (!Number.isFinite(expected) || expected <= tolerance) {
    return { disposition: "review", reason: "The expected quantity is missing or zero.", remainingQuantity, normalizedCostCode, normalizedUom };
  }
  if (remainingQuantity <= tolerance) {
    return { disposition: "complete", reason: used > expected + tolerance ? "Used quantity is already over expected." : "Expected quantity is already accounted for.", remainingQuantity, normalizedCostCode, normalizedUom };
  }
  if (!FORMS_COST_CODES.includes(normalizedCostCode as typeof FORMS_COST_CODES[number])) {
    return { disposition: "review", reason: "The line is not assigned to a configured forms cost code.", remainingQuantity, normalizedCostCode, normalizedUom };
  }
  if (FORM_EXCLUSION_PATTERN.test(description)) {
    return { disposition: "review", reason: "The description appears to be form release or form oil, not formwork.", remainingQuantity, normalizedCostCode, normalizedUom };
  }
  if (!FORM_DESCRIPTION_PATTERN.test(description)) {
    return { disposition: "review", reason: "The description does not clearly identify forms or formwork.", remainingQuantity, normalizedCostCode, normalizedUom };
  }
  if (!SF_UOMS.has(normalizedUom)) {
    return { disposition: "review", reason: `Unit ${normalizedUom || "(blank)"} needs review; automatic closeout requires SF.`, remainingQuantity, normalizedCostCode, normalizedUom };
  }

  return {
    disposition: "ready",
    reason: "Ready to add the unaccounted expected forms quantity.",
    remainingQuantity,
    normalizedCostCode,
    normalizedUom,
  };
}

