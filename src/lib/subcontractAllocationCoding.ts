const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const code = (value: unknown) => { const row = record(value); return text(row.full_code || row.flat_code || row.code || value); };

/** No default cost type: an unknown assignment must be reviewed explicitly. */
export function allocationBudgetCode(payload: unknown): string {
  const line = record(payload);
  const item = record(line.cost_item);
  const explicit = code(line.cost_code) || code(line.budget_code) || code(line.wbs_code);
  const value = explicit || code(item.cost_code);
  if (!value) return '';
  if (value.includes('.')) return value;
  const type = code(line.cost_code_type) || text(line.cost_type_code) || (!explicit ? text(item.cost_type_code) : '');
  return type ? `${value}.${type}` : '';
}

export function allocationCachedCoding(snapshot: unknown, boardId: string, proposalId: string, lineId: string, costItemId: string): string {
  const cache = record(snapshot);
  if (text(cache.bidBoardProjectId) !== boardId || text(record(cache.proposal).id) !== proposalId || !Array.isArray(cache.lines)) return '';
  const matches = cache.lines.map(record).filter(line => text(line.id) === lineId && !!costItemId && text(record(line.cost_item).id) === costItemId);
  return matches.length === 1 ? allocationBudgetCode(matches[0]) : '';
}
