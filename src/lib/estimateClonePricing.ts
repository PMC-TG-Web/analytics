type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function readRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export type EstimateCloneLaborRateRepair = {
  lineItemId: string;
  costItemId: string;
  unitLaborRate: number;
  body: {
    cost_item: {
      id: string;
      based_on_item_id: string;
      unit_labor_rate: number;
    };
  };
};

export type EstimateCloneTakeoffQuantityRepair = {
  lineItemId: string;
  quantity: number;
  body: {
    quantity: number;
  };
};

/** Procore Estimating margin fields are percent values (e.g. 12.5 for 12.5%). */
export function deriveEstimateCloneMargin(cost: unknown, sales: unknown): number | null {
  const numericCost = readNumber(cost);
  const numericSales = readNumber(sales);
  if (numericCost === undefined || numericSales === undefined || Math.abs(numericSales) < 1e-9) {
    return null;
  }

  return ((numericSales - numericCost) / numericSales) * 100;
}

export function buildEstimateCloneLaborRateRepair(
  sourceLineItem: UnknownRecord,
  createdResponse: unknown
): EstimateCloneLaborRateRepair | null {
  const sourceCostItem = readRecord(sourceLineItem.cost_item);
  const sourceRate = readNumber(sourceCostItem.unit_labor_rate);
  if (sourceRate === undefined) return null;

  const responseRecord = readRecord(createdResponse);
  const createdLineItem = readRecord(responseRecord.data ?? createdResponse);
  const createdCostItem = readRecord(createdLineItem.cost_item);
  const lineItemId = readString(createdLineItem.id ?? createdLineItem.line_item_id);
  const costItemId = readString(createdCostItem.id);
  if (!lineItemId || !costItemId) return null;

  const createdRate = readNumber(createdCostItem.unit_labor_rate);
  if (createdRate !== undefined && Math.abs(createdRate - sourceRate) < 1e-9) return null;

  return {
    lineItemId,
    costItemId,
    unitLaborRate: sourceRate,
    body: {
      cost_item: {
        id: costItemId,
        based_on_item_id: costItemId,
        unit_labor_rate: sourceRate,
      },
    },
  };
}

export function buildEstimateCloneTakeoffQuantityRepair(
  sourceLineItem: UnknownRecord,
  createdResponse: unknown
): EstimateCloneTakeoffQuantityRepair | null {
  const sourceTakeoffQuantity = readNumber(sourceLineItem.takeoff_quantity);
  if (sourceTakeoffQuantity === undefined || sourceTakeoffQuantity <= 0) return null;

  const responseRecord = readRecord(createdResponse);
  const createdLineItem = readRecord(responseRecord.data ?? createdResponse);
  const lineItemId = readString(createdLineItem.id ?? createdLineItem.line_item_id);
  if (!lineItemId) return null;

  const createdTakeoffQuantity = readNumber(createdLineItem.takeoff_quantity) ?? 0;
  if (Math.abs(createdTakeoffQuantity - sourceTakeoffQuantity) < 1e-9) return null;

  const pricingFields = ["item_cost", "item_sales", "labor_cost", "labor_sales"] as const;
  const sourceHasPricing = pricingFields.some(
    (field) => Math.abs(readNumber(sourceLineItem[field]) ?? 0) > 1e-9
  );
  if (!sourceHasPricing) return null;

  const pricingAlreadyMatches = pricingFields.every((field) => {
    const sourceValue = readNumber(sourceLineItem[field]) ?? 0;
    const createdValue = readNumber(createdLineItem[field]) ?? 0;
    return Math.abs(sourceValue - createdValue) < 1e-6;
  });
  if (pricingAlreadyMatches) return null;

  return {
    lineItemId,
    quantity: sourceTakeoffQuantity,
    body: {
      quantity: sourceTakeoffQuantity,
    },
  };
}
