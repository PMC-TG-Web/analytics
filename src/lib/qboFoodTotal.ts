export const FOOD_LINE_KEY = 'food:01-300-10-80';
export function foodTotalAmount(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a Food amount of $0 or more, with at most two decimal places.');
  return Number(value.trim()).toFixed(2);
}
export type FoodTotalRecord = { amount: string; revision: number; updatedBy: string; updatedAt: string };
export type FoodEntryInput = { entryId: string; companyId: string; projectId: string; month: string; spentOn: string; note: string; amount: string };
export type FoodEntry = { id: string; spentOn: string; note: string; amount: string; createdBy: string; createdAt: string };
export function validateFoodEntry(input: FoodEntryInput) {
  const day = new Date(`${input.spentOn}T00:00:00Z`);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.entryId || '') || ![input.companyId, input.projectId].every(id => typeof id === 'string' && /^\d+$/.test(id)) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month || '') || typeof input.spentOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.spentOn) || input.spentOn.slice(0, 7) !== input.month || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== input.spentOn || typeof input.note !== 'string' || input.note.length > 200) throw new Error('Enter a valid Food expense date within the selected month and a note of 200 characters or fewer.');
  return { ...input, amount: foodTotalAmount(input.amount), note: input.note.trim() };
}
export function foodTotalLine(companyId: string, projectId: string, month: string, saved: FoodTotalRecord | null) {
  if (!saved || Number(saved.amount) === 0) return null;
  const amount = foodTotalAmount(saved.amount);
  return { lineKey: FOOD_LINE_KEY, sourceType: 'manual_food' as const, description: 'Food', costCode: '01-300-10-80', costType: 'Materials', quantity: '1', unitCost: amount, amount, uom: 'total', sourceLogs: [],
    foodTotal: { companyId, projectId, month, amount, revision: saved.revision, updatedBy: saved.updatedBy },
  };
}
