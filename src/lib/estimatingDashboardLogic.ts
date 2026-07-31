export type EstimateProposalCandidate = {
  proposalId: string;
  isPrimaryEstimate?: boolean | null;
  isBaselineCandidate?: boolean | null;
  normalizedLineCount?: number | null;
  sourceUpdatedAt?: Date | string | null;
  syncedAt?: Date | string | null;
  payload?: unknown;
};

export type EstimateAmountLine = {
  name?: string | null;
  costCode?: string | null;
  uom?: string | null;
  quantity?: unknown;
  itemCost?: unknown;
  itemSales?: unknown;
  laborCost?: unknown;
  laborSales?: unknown;
  laborHours?: unknown;
  payload?: unknown;
};

export function canonicalBidBoardId(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const parts = normalized.split(":");
  return parts[parts.length - 1].trim();
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function numericValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown): number {
  if (!value) return 0;
  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function proposalType(proposal: EstimateProposalCandidate): string {
  return String(recordValue(proposal.payload).type ?? "").trim().toUpperCase();
}

export function compareEstimateProposals(
  left: EstimateProposalCandidate,
  right: EstimateProposalCandidate,
): number {
  if (Boolean(left.isPrimaryEstimate) !== Boolean(right.isPrimaryEstimate)) {
    return right.isPrimaryEstimate ? 1 : -1;
  }

  const leftIsEstimate = left.isBaselineCandidate || proposalType(left) === "ESTIMATE";
  const rightIsEstimate = right.isBaselineCandidate || proposalType(right) === "ESTIMATE";
  if (leftIsEstimate !== rightIsEstimate) return rightIsEstimate ? 1 : -1;

  // Procore can leave an auto-created "Original Estimate" with no lines after
  // the actual estimate is cloned or revised. Prefer a populated estimate in
  // that case, but retain the baseline preference when both contain data (or
  // when line-count information is not available to the caller).
  const leftHasLines = left.normalizedLineCount === undefined
    ? null
    : Number(left.normalizedLineCount || 0) > 0;
  const rightHasLines = right.normalizedLineCount === undefined
    ? null
    : Number(right.normalizedLineCount || 0) > 0;
  if (leftIsEstimate && leftHasLines !== null && rightHasLines !== null && leftHasLines !== rightHasLines) {
    return rightHasLines ? 1 : -1;
  }

  const leftPriority = left.isBaselineCandidate ? 3 : leftIsEstimate ? 2 : 1;
  const rightPriority = right.isBaselineCandidate ? 3 : rightIsEstimate ? 2 : 1;
  if (leftPriority !== rightPriority) return rightPriority - leftPriority;

  const leftUpdated = dateValue(left.sourceUpdatedAt) || dateValue(left.syncedAt);
  const rightUpdated = dateValue(right.sourceUpdatedAt) || dateValue(right.syncedAt);
  if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;

  return String(right.proposalId).localeCompare(String(left.proposalId), undefined, { numeric: true });
}

export function selectEstimateProposal<T extends EstimateProposalCandidate>(
  proposals: T[],
  options: { requirePrimary?: boolean } = {},
): T | null {
  const candidates = options.requirePrimary
    ? proposals.filter((proposal) => proposal.isPrimaryEstimate)
    : proposals;
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareEstimateProposals)[0] ?? null;
}

const LABOR_CODE_GROUPS: Record<string, string> = {
  "01-300-10-20": "PM",
  "01-300-10-30": "Travel Labor",
  "03-300-20-10": "Slab On Grade Labor",
  "03-200-30-10": "Slab On Grade Labor",
  "03-300-40-70": "Slab On Grade Labor",
  "05-100-10-30": "Site Concrete Labor",
  "03-300-30-10": "Site Concrete Labor",
  "03-200-40-10": "Site Concrete Labor",
  "03-150-10-10": "Site Concrete Labor",
  "31-100-10-10": "Site Concrete Labor",
  "03-100-20-10": "Wall Labor",
  "03-300-10-10": "Wall Labor",
  "03-200-20-10": "Wall Labor",
  "03-300-00-10": "Foundation Labor",
  "03-100-10-10": "Foundation Labor",
  "03-200-10-10": "Foundation Labor",
  "03-300-00-12": "Foundation Labor",
  "03-300-00-14": "Foundation Labor",
  "03-300-00-16": "Foundation Labor",
  "31-100-10-20": "Foundation Labor",
};

export function classifyLaborGroup(line: Pick<EstimateAmountLine, "name" | "costCode" | "payload">): string {
  const directCode = String(line.costCode ?? "").trim().replace(/\.L$/i, "");
  if (LABOR_CODE_GROUPS[directCode]) return LABOR_CODE_GROUPS[directCode];

  const payload = recordValue(line.payload);
  const costItem = recordValue(payload.cost_item);
  const payloadCode = String(costItem.cost_code ?? "").trim().replace(/\.L$/i, "");
  if (LABOR_CODE_GROUPS[payloadCode]) return LABOR_CODE_GROUPS[payloadCode];

  const text = [line.name, costItem.name, costItem.cost_name, costItem.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(project\s+management|management|supervision)\b/.test(text)) return "PM";
  if (/\b(slab\s+on\s+grade|sog|interior\s+(?:concrete|sealer))\b/.test(text)) return "Slab On Grade Labor";
  if (/\b(wall|retaining\s+wall)\b/.test(text)) return "Wall Labor";
  if (/\b(foundation|footing|spreadfooting|pier|excavat|backfill)\b/.test(text)) return "Foundation Labor";
  if (/\b(site\s+concrete|bollard|waterstop|stone\s+grad)\b/.test(text)) return "Site Concrete Labor";
  if (/\btravel\b/.test(text)) return "Travel Labor";
  return "Other Labor";
}

export const CONCRETE_GROUPS = [
  "Slab On Grade",
  "Site",
  "Wall",
  "Foundation",
] as const;

export type ConcreteGroup = typeof CONCRETE_GROUPS[number];

export function concreteYardQuantity(line: Pick<EstimateAmountLine, "name" | "uom" | "quantity">): number {
  const name = String(line.name ?? "").trim().toLowerCase();
  const uom = String(line.uom ?? "").trim().toUpperCase();
  const supportedUom = ["CU_YD", "CU YD", "CY", "CYD", "CUBIC YARD", "CUBIC YARDS", "EA"].includes(uom);
  if (!supportedUom || !name.includes("concrete")) return 0;

  // These are concrete-adjacent costs or measured scopes, not ready-mix yards.
  if (/\b(labor|form|pump|fee|wash\s*out|washout|epoxy|repair|subcontract|saw|sealer|joint|infill)\b/.test(name)) {
    return 0;
  }

  const quantity = numericValue(line.quantity);
  return quantity > 0 ? quantity : 0;
}

export function classifyConcreteGroup(
  line: Pick<EstimateAmountLine, "name">,
  scopeLaborGroup?: string | null,
): ConcreteGroup | null {
  const name = String(line.name ?? "").trim().toLowerCase();
  if (/\b(slab\s+on\s+grade|sog)\b/.test(name)) return "Slab On Grade";
  if (/\bwall\b/.test(name)) return "Wall";
  if (/\b(foundation|footing|spreadfooting|pier)\b/.test(name)) return "Foundation";
  if (/\b(site|bollard|curb|sidewalk|apron)\b/.test(name)) return "Site";

  if (scopeLaborGroup === "Slab On Grade Labor") return "Slab On Grade";
  if (scopeLaborGroup === "Site Concrete Labor") return "Site";
  if (scopeLaborGroup === "Wall Labor") return "Wall";
  if (scopeLaborGroup === "Foundation Labor") return "Foundation";
  return null;
}

export function classifyEstimateCostType(line: EstimateAmountLine): string {
  const payload = recordValue(line.payload);
  const costItem = recordValue(payload.cost_item);
  const type = String(costItem.type ?? "").trim().toUpperCase();
  const costTypeCode = String(costItem.cost_type_code ?? "").trim().toUpperCase();

  if (type === "LABOR" || numericValue(line.laborHours) > 0 || numericValue(line.laborCost) > 0) return "Labor";
  if (type === "SUBCONTRACTOR" || costTypeCode === "S") return "Subcontractor";
  if (type === "EQUIPMENT" || costTypeCode === "E") return "Equipment";
  return "Part";
}

export function addEstimateLineAmounts(
  totals: { sales: number; cost: number; hours: number; laborSales: number; laborCost: number },
  line: EstimateAmountLine,
) {
  const itemSales = numericValue(line.itemSales);
  const itemCost = numericValue(line.itemCost);
  const laborSales = numericValue(line.laborSales);
  const laborCost = numericValue(line.laborCost);

  totals.sales += itemSales + laborSales;
  totals.cost += itemCost + laborCost;
  totals.hours += numericValue(line.laborHours);
  totals.laborSales += laborSales;
  totals.laborCost += laborCost;
  return totals;
}
