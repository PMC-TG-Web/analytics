import {
  COMMITMENT_MAKER_COST_TYPE,
  type CommitmentMakerGroup,
  type CommitmentMakerLineItem,
} from "@/lib/procore/commitmentMaker";

type UnknownRecord = Record<string, unknown>;

export type CommitmentMakerApprovedChangeOrder = {
  packageId: string;
  number: string;
  title: string;
};

export function isAvailableApprovedPotentialChangeOrder(value: unknown): boolean {
  const source = record(value);
  const status = text(source.status).toLowerCase();
  const id = text(source.id);
  const packageAcronym = text(source.change_order_package_acronym_number);
  return status === "approved" && Boolean(id) && !/#\s*\d+/i.test(packageAcronym);
}

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function baseCostCode(value: unknown): string {
  return text(value).split(".")[0].substring(0, 12);
}

function sourceDescription(line: UnknownRecord, costCode: string): string {
  const wbs = record(line.wbs_code ?? line.wbsCode);
  const costCodeRecord = record(line.cost_code ?? line.costCode);
  const wbsDescription = text(wbs.description).replace(/\.[^.]+$/, "");
  return text(line.description) || wbsDescription || text(costCodeRecord.name) || costCode;
}

/**
 * Turns an approved Prime Contract Change Order SOV into one editable/reviewable
 * commitment group. The original cost-type suffix is intentionally omitted:
 * Commitment Maker writes Paradise Masonry lines to the project's Other (O)
 * WBS code, matching the established base-estimate workflow.
 */
export function approvedChangeOrderCommitmentGroup(
  changeOrder: CommitmentMakerApprovedChangeOrder,
  sourceLines: UnknownRecord[],
): CommitmentMakerGroup {
  const lineItems = sourceLines.map((line): CommitmentMakerLineItem | null => {
    const wbs = record(line.wbs_code ?? line.wbsCode);
    const costCodeRecord = record(line.cost_code ?? line.costCode);
    const costCode = baseCostCode(
      text(costCodeRecord.full_code)
      || text(line.cost_code_string)
      || text(wbs.flat_code)
      || line.costCode
      || line.cost_code,
    );
    const quantity = number(line.quantity);
    const unitCost = number(line.unit_cost ?? line.unitCost);
    const uom = text(line.uom) || "ls";
    if (!costCode || quantity === null || quantity <= 0 || unitCost === null || unitCost < 0) return null;
    return {
      costCode,
      costType: COMMITMENT_MAKER_COST_TYPE,
      description: sourceDescription(line, costCode),
      quantity,
      uom,
      unitCost: Math.round(unitCost * 10_000) / 10_000,
      subtotalOverride: null,
    };
  }).filter((line): line is CommitmentMakerLineItem => Boolean(line));

  const label = [changeOrder.number ? `CO ${changeOrder.number}` : "Change Order", changeOrder.title]
    .filter(Boolean)
    .join(" — ");
  return {
    name: label || `Change Order ${changeOrder.packageId}`,
    lineItems,
  };
}

export function commitmentChangeOrderTitle(changeOrder: CommitmentMakerApprovedChangeOrder): string {
  return [changeOrder.number ? `Prime CO ${changeOrder.number}` : "Prime Change Order", changeOrder.title]
    .filter(Boolean)
    .join(" — ")
    .substring(0, 255);
}
