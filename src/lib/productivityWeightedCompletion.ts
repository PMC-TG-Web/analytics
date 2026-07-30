export type ProductivityCompletionLine = {
  description?: string | null;
  costCode?: string | null;
  uom?: string | null;
  expectedQuantity: number;
  usedQuantity: number;
};

export type ProductivityCompletionLabor = {
  expectedHours: number;
  totalHours: number;
};

export type CompletionCategory = "concrete" | "rebar" | "labor" | "other";

export type WeightedCompletionBreakdown = {
  category: CompletionCategory;
  ratio: number;
  weight: number;
};

export type WeightedCompletion = {
  ratio: number | null;
  breakdown: WeightedCompletionBreakdown[];
};

const MAJOR_COMPLETION_SHARE = 0.8;
const OTHER_COMPLETION_SHARE = 0.2;
const CONCRETE_COST_CODES = new Set([
  "03-300-30-20",
  "03-300-20-20",
  "03-300-10-20",
  "03-300-00-20",
  "05-100-10-20",
]);

function clean(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function isFiberLine(description: unknown): boolean {
  return /\bfib(?:er|re)/.test(clean(description));
}

export function classifyProductivityCompletionLine(
  line: Pick<ProductivityCompletionLine, "description" | "costCode" | "uom">,
): Exclude<CompletionCategory, "labor"> {
  const description = clean(line.description);
  const costCode = clean(line.costCode);
  const uom = clean(line.uom);

  // Fiber is purchased and tracked by each even when it shares a concrete
  // material cost code. It must not contribute to the concrete CY rollup.
  if (isFiberLine(description)) return "other";

  // These are concrete quantity codes even when legacy Procore commitments
  // carry EA instead of CY.
  if (CONCRETE_COST_CODES.has(costCode)) return "concrete";

  // Reinforcing descriptions take precedence over UOM because a handful of
  // legacy commitment lines carry an incorrect CY unit.
  if (
    costCode.startsWith("03-200-")
    || /\b(rebar|reinforc|wire\s*mesh|welded\s*wire|wwf|bar\s*chair|smooth\s*dowel)\b/.test(description)
  ) {
    return "rebar";
  }

  if (uom === "cy") return "concrete";

  return "other";
}

export function normalizeProductivityCompletionUom(
  line: Pick<ProductivityCompletionLine, "description" | "costCode" | "uom">,
): string | null {
  if (isFiberLine(line.description)) return "EA";
  if (CONCRETE_COST_CODES.has(clean(line.costCode))) return "CY";
  const uom = String(line.uom ?? "").trim();
  return uom || null;
}

function materialCategoryRatio(
  lines: ProductivityCompletionLine[],
  category: Exclude<CompletionCategory, "labor">,
): number | null {
  const byUom = new Map<string, { expected: number; used: number }>();

  for (const line of lines) {
    if (classifyProductivityCompletionLine(line) !== category) continue;
    if (!Number.isFinite(line.expectedQuantity) || line.expectedQuantity <= 0) continue;

    const uom = clean(normalizeProductivityCompletionUom(line)).toUpperCase() || "UNITS";
    const current = byUom.get(uom) || { expected: 0, used: 0 };
    current.expected += line.expectedQuantity;
    current.used += Number.isFinite(line.usedQuantity) ? line.usedQuantity : 0;
    byUom.set(uom, current);
  }

  const ratios = [...byUom.values()]
    .filter((total) => total.expected > 0)
    .map((total) => clampRatio(total.used / total.expected));
  if (!ratios.length) return null;

  // Quantities with different units cannot be added. Give each UOM rollup an
  // equal voice after quantity-weighting the lines within that UOM.
  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

function laborCategoryRatio(labor: ProductivityCompletionLabor[]): number | null {
  const expected = labor.reduce(
    (sum, group) => sum + (Number.isFinite(group.expectedHours) && group.expectedHours > 0 ? group.expectedHours : 0),
    0,
  );
  if (expected <= 0) return null;
  const used = labor.reduce(
    (sum, group) => sum + (Number.isFinite(group.totalHours) ? group.totalHours : 0),
    0,
  );
  return clampRatio(used / expected);
}

export function calculateWeightedCompletion(params: {
  lines: ProductivityCompletionLine[];
  labor?: ProductivityCompletionLabor[];
}): WeightedCompletion {
  const categories = new Map<CompletionCategory, number>();
  for (const category of ["concrete", "rebar", "other"] as const) {
    const ratio = materialCategoryRatio(params.lines, category);
    if (ratio !== null) categories.set(category, ratio);
  }

  if (params.labor) {
    const ratio = laborCategoryRatio(params.labor);
    if (ratio !== null) categories.set("labor", ratio);
  }

  const major = (["concrete", "rebar", "labor"] as const)
    .filter((category) => categories.has(category));
  const hasOther = categories.has("other");
  if (!major.length && !hasOther) return { ratio: null, breakdown: [] };

  const breakdown: WeightedCompletionBreakdown[] = [];
  if (major.length) {
    const majorShare = hasOther ? MAJOR_COMPLETION_SHARE : 1;
    const weight = majorShare / major.length;
    for (const category of major) {
      breakdown.push({ category, ratio: categories.get(category)!, weight });
    }
  }
  if (hasOther) {
    breakdown.push({
      category: "other",
      ratio: categories.get("other")!,
      weight: major.length ? OTHER_COMPLETION_SHARE : 1,
    });
  }

  return {
    ratio: breakdown.reduce((sum, item) => sum + item.ratio * item.weight, 0),
    breakdown,
  };
}
