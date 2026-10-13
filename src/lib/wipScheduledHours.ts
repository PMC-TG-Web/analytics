import { allocationHours, validateWipAllocations, type WipAllocation, type WipSource } from './wipPlanning.ts';

export type WipScheduledHours = {
  months: Record<string, number>;
  years: string[];
  planCount: number;
  excludedDraftCount: number;
  localOnly: boolean;
};

/** Read saved snapshots, including historical plans; never use current estimates or draft percentages. */
export function calculateWipScheduledHours(plans: { source: WipSource; allocations: WipAllocation[] }[]): Pick<WipScheduledHours, 'months' | 'years' | 'planCount'> {
  const months: Record<string, number> = {};
  for (const plan of plans) {
    const hours = plan.source?.allocatableHours;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0) throw new Error('Invalid saved WIP hours.');
    for (const allocation of validateWipAllocations(plan.allocations)) {
      months[allocation.month] = (months[allocation.month] || 0) + allocationHours(hours, allocation.percent);
    }
  }
  // Preserve sub-hour accuracy; round only summed floating-point noise.
  for (const month of Object.keys(months)) months[month] = Math.round(months[month] * 1e6) / 1e6;
  return { months, years: [...new Set(Object.keys(months).map(month => month.slice(0, 4)))].sort(), planCount: plans.length };
}
