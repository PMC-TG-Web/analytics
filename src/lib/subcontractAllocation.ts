export type AllocationLine = {
  id: string; groupId: string; groupName: string; name: string; costCode: string; uom: string;
  quantity: number | null; unitCost: number | null;
  budgetCode?: string;
  unitRevenue?: number | null;
};
export type AllocationBudget = { id: string; name: string; costCode: string; amount: number | null };
export type AllocationPoLine = {
  id: string; procoreLineId: string; poId: string; poName: string; name: string; costCode: string; uom: string;
  quantity: number | null; unitCost: number | null;
};
export type AllocationSource = {
  projectId: string; projectName: string; bidBoardProjectId: string; proposalId: string; proposalName: string;
  syncedAt: string; lines: AllocationLine[]; budgets: AllocationBudget[]; poLines: AllocationPoLine[];
};
export type AllocationChanges = {
  allocations: { lineId: string; quantity: number }[];
  budgets: { lineId: string; change: number }[];
  purchaseOrders: { lineId: string; quantity: number }[];
  reason: string;
  budgetMappings?: { lineId: string; fromBudgetId: string; toBudgetId: string }[];
};

export function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function allocationEligible(line: AllocationLine) {
  return line.quantity !== null && line.quantity > 0 && line.unitCost !== null && line.unitCost >= 0;
}

/** Checkboxes act directly on allocation quantities; there is no separate selection. */
export function toggleSubcontractAllocation(source: AllocationSource, changes: AllocationChanges, ids: string[], checked: boolean): AllocationChanges {
  const targets = source.lines.filter(line => ids.includes(line.id) && allocationEligible(line));
  const targetIds = new Set(targets.map(line => line.id));
  return { ...changes, allocations: [
    ...changes.allocations.filter(row => !targetIds.has(row.lineId)),
    ...(checked ? targets.map(line => ({ lineId: line.id, quantity: line.quantity! })) : []),
  ] };
}

export function allocationGroupCheck(lines: AllocationLine[], changes: AllocationChanges) {
  const eligible = lines.filter(allocationEligible);
  const quantity = (id: string) => changes.allocations.find(row => row.lineId === id)?.quantity ?? 0;
  const checked = eligible.length > 0 && eligible.every(line => quantity(line.id) === line.quantity);
  return { checked, partial: !checked && eligible.some(line => quantity(line.id) > 0) };
}

/** Extended estimate costs take precedence over today's catalog price. */
export function estimateAllocationUnitCost(quantity: number | null, itemCost: number | null, laborCost: number | null) {
  if (!quantity || (itemCost === null && laborCost === null)) return null;
  return ((itemCost ?? 0) + (laborCost ?? 0)) / quantity;
}

export const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Operator-supplied subcontractor catalog, independent of existing project budgets. */
export const subcontractDestinations = [
  { itemId: '51482336', name: 'Foundation Subcontractor', costCode: '03-300-00-50.S', costName: 'Foundation Subcontractor', description: 'Subcontractor For Foundations' },
  { itemId: '51482352', name: 'Masonry Subcontractor', costCode: '04-100-10-20.S', costName: 'Masonry Sub', description: 'Masonry Subcontractor' },
  { itemId: '51482338', name: 'Poured Wall Subcontractor', costCode: '03-300-10-50.S', costName: 'Wall Subcontractor', description: 'Poured Wall Subcontractor' },
  { itemId: '51482350', name: 'Site Concrete Subcontractor', costCode: '03-300-30-50.S', costName: 'Site Subcontractor', description: 'Subcontractor For Site Concrete' },
  { itemId: '51482344', name: 'Slab on Grade Subcontractor', costCode: '03-300-20-50.S', costName: 'SOG Subcontractor', description: 'Subcontractor For Slabs On Grade' },
] as const;

export function subcontractBudgetOptions(source: AllocationSource) {
  return subcontractDestinations.map(destination => {
    const existing = source.budgets.filter(budget => budget.costCode === destination.costCode);
    // Draft destinations identify a code, not an arbitrarily selected duplicate mirror row.
    return { ...destination, id: `subcontract-code:${destination.costCode}`,
      amount: existing.length === 1 ? existing[0].amount : null, proposed: !existing.length };
  });
}

function subcontractDestinationId(source: AllocationSource, id: string) {
  const options = subcontractBudgetOptions(source);
  if (!id || options.some(option => option.id === id)) return id;
  const legacy = source.budgets.find(line => line.id === id && /subcontractor/i.test(`${line.costCode} ${line.name}`));
  const code = legacy ? `${legacy.costCode.trim().replace(/\.[^.]+$/, '')}.S` : '';
  return options.find(option => option.costCode === code)?.id || id;
}

/** Validate exact source identities; never infer ownership from descriptions or cost codes. */
export function validateAllocationChanges(source: AllocationSource, input: unknown): AllocationChanges {
  if (!input || typeof input !== 'object') throw new Error('Invalid allocation draft.');
  const raw = input as AllocationChanges;
  if (raw.reason !== undefined && (typeof raw.reason !== 'string' || raw.reason.length > 1000)) {
    throw new Error('Invalid draft note.');
  }
  function rows<T>(value: T[], limit: number): T[] {
    if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid draft rows.');
    const seen = new Set<string>();
    for (const row of value) {
      const id = (row as { lineId?: string })?.lineId;
      if (typeof id !== 'string' || !id || seen.has(id)) throw new Error('Duplicate or invalid line identity.');
      seen.add(id);
    }
    return value;
  }
  function number(value: unknown, precision: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12
      || Math.abs(value * precision - Math.round(value * precision)) > 0.001) {
      throw new Error('Enter a finite quantity (four decimals) or budget change (two decimals).');
    }
    return value;
  }
  const allocations = rows(raw.allocations, source.lines.length).map(row => {
    const line = source.lines.find(line => line.id === row.lineId);
    const quantity = number(row.quantity, 10000);
    if (!line || !allocationEligible(line) || quantity < 0 || quantity > line.quantity!) {
      throw new Error('Subcontract quantity must be between zero and the current estimate quantity.');
    }
    return { lineId: line.id, quantity };
  }).filter(row => row.quantity !== 0);
  const budgets = rows(raw.budgets, source.budgets.length).map(row => {
    const line = source.budgets.find(line => line.id === row.lineId);
    const change = number(row.change, 100);
    if (!line || line.amount === null) throw new Error('The selected budget line is unavailable.');
    return { lineId: line.id, change };
  }).filter(row => row.change !== 0);
  const purchaseOrders = rows(raw.purchaseOrders, source.poLines.length).map(row => {
    const line = source.poLines.find(line => line.id === row.lineId);
    const quantity = number(row.quantity, 10000);
    if (!line || line.quantity === null || line.unitCost === null || quantity < 0) {
      throw new Error('Select an existing PO line with quantity and pricing, and enter a nonnegative quantity.');
    }
    return { lineId: line.id, quantity };
  }).filter(row => row.quantity !== source.poLines.find(line => line.id === row.lineId)!.quantity);
  const budgetMappings = rows(raw.budgetMappings ?? [], source.lines.length).map(row => {
    const toBudgetId = subcontractDestinationId(source, row.toBudgetId);
    if (!source.lines.some(line => line.id === row.lineId)
      || typeof toBudgetId !== 'string' || (toBudgetId && !subcontractBudgetOptions(source).some(line => line.id === toBudgetId))) throw new Error('Choose a subcontractor destination ending in .S.');
    return { lineId: row.lineId, fromBudgetId: '', toBudgetId };
  });
  return { allocations, budgets, purchaseOrders, reason: raw.reason?.trim() || '', ...(budgetMappings.length ? { budgetMappings } : {}) };
}

/** Derived afresh from quantities; never add a previous proposal back into itself. */
export function allocationBudgetPlan(source: AllocationSource, changes: AllocationChanges) {
  const rows = changes.allocations.filter(row => Number.isFinite(row.quantity) && row.quantity > 0).flatMap(row => {
    const line = source.lines.find(line => line.id === row.lineId);
    if (!line || !allocationEligible(line)) return [];
    const amount = money(row.quantity * line.unitCost!);
    const revenue = line.unitRevenue === null || line.unitRevenue === undefined ? null : money(row.quantity * line.unitRevenue);
    const mapping = changes.budgetMappings?.find(mapping => mapping.lineId === line.id);
    const candidates = source.budgets.filter(budget => !!line.budgetCode && budget.costCode === line.budgetCode && budget.amount !== null);
    // The selected estimate line is authoritative. Legacy manual source overrides are ignored.
    const fromBudgetId = candidates.length === 1 ? candidates[0].id : '';
    const fromBudgetCode = line.budgetCode || line.costCode;
    const toBudgetId = subcontractDestinationId(source, mapping?.toBudgetId || '');
    const destination = subcontractBudgetOptions(source).find(option => option.id === toBudgetId);
    const hasValue = amount !== 0 || revenue !== 0;
    const status = !hasValue ? 'Zero estimate value'
      : revenue === null ? 'Estimate revenue unavailable'
      : !destination ? 'Choose subcontractor destination' : 'Ready for review';
    return [{ line, quantity: row.quantity, amount, revenue, fromBudgetId, fromBudgetCode, toBudgetId, destination, status,
      needsTransfer: hasValue, ready: status === 'Ready for review' }];
  });
  // Review ledger retains exact estimate-line identity and description on both sides.
  // A duplicate mirror record must never require the operator to reselect the source.
  // These are draft deltas, not executable Procore budget-line mutations.
  const adjustments = rows.filter(row => row.ready).flatMap(row => {
    const destination = subcontractBudgetOptions(source).find(line => line.id === row.toBudgetId)!;
    return [
      { id: `estimate:${row.line.id}`, name: row.line.name, costCode: row.fromBudgetCode, change: -row.amount, revenueChange: -row.revenue! },
      { id: `destination:${row.line.id}`, name: row.line.name, costCode: destination.costCode, change: row.amount, revenueChange: row.revenue! },
    ];
  });
  for (const row of changes.budgets) {
    const line = source.budgets.find(line => line.id === row.lineId);
    if (line) adjustments.push({ id: `manual:${line.id}`, name: line.name, costCode: line.costCode, change: row.change, revenueChange: 0 });
  }
  return { rows, pending: rows.filter(row => row.needsTransfer && !row.ready).length,
    transferAmount: money(rows.filter(row => row.needsTransfer).reduce((sum, row) => sum + row.amount, 0)),
    transferRevenue: rows.some(row => row.needsTransfer && row.revenue === null) ? null : money(rows.filter(row => row.needsTransfer).reduce((sum, row) => sum + (row.revenue ?? 0), 0)),
    readyAmount: money(rows.filter(row => row.ready).reduce((sum, row) => sum + row.amount, 0)),
    adjustments };
}

export function allocationTotals(source: AllocationSource, changes: AllocationChanges) {
  return {
    subcontract: money(changes.allocations.reduce((sum, row) => sum + money(row.quantity * (source.lines.find(line => line.id === row.lineId)?.unitCost ?? 0)), 0)),
    budgetChange: money(changes.budgets.reduce((sum, row) => sum + row.change, 0)),
    poChange: money(changes.purchaseOrders.reduce((sum, row) => {
      const line = source.poLines.find(line => line.id === row.lineId);
      return sum + (line ? money(row.quantity * (line.unitCost ?? 0)) - money((line.quantity ?? 0) * (line.unitCost ?? 0)) : 0);
    }, 0)),
  };
}
