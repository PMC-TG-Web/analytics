export const FOOD_LINE_KEY = 'food:01-300-10-80';
export function foodTotalAmount(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a total Food cost of $0 or more, with at most two decimal places.');
  return Number(value.trim()).toFixed(2);
}
export type FoodTotalRecord = { amount: string; revision: number; updatedBy: string; updatedAt: string };
export function foodTotalLine(companyId: string, projectId: string, month: string, saved: FoodTotalRecord | null) {
  if (!saved || Number(saved.amount) === 0) return null;
  const amount = foodTotalAmount(saved.amount);
  return { lineKey: FOOD_LINE_KEY, sourceType: 'manual_food' as const, description: 'Food', costCode: '01-300-10-80', costType: 'Materials', quantity: '1', unitCost: amount, amount, uom: 'total', sourceLogs: [],
    foodTotal: { companyId, projectId, month, amount, revision: saved.revision, updatedBy: saved.updatedBy },
  };
}
