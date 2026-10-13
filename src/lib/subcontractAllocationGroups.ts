type RecordValue = Record<string, unknown>;
import type { AllocationSource } from './subcontractAllocation';
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/** Cached group IDs are meaningful only inside this exact board and proposal. */
export function allocationGroupNames(snapshot: unknown, boardId: string, proposalId: string): Map<string, string> {
  const value = record(snapshot);
  if (text(value.bidBoardProjectId) !== boardId || text(record(value.proposal).id) !== proposalId) return new Map();
  return groupNamesFromRecords(value.groups);
}

export function groupNamesFromRecords(value: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(value)) return names;
  for (const entry of value) {
    const group = record(entry);
    const id = text(group.id);
    const name = text(group.name || group.title);
    if (id && name) {
      if (names.has(id) && names.get(id) !== name) throw new Error('Conflicting estimate group names. Refresh the group metadata.');
      names.set(id, name);
    }
  }
  return names;
}

export function resolveAllocationGroup(line: { groupId?: string | null; groupName?: string | null; payload?: unknown }, names: Map<string, string>) {
  const payload = record(line.payload);
  const nested = record(payload.group);
  const groupId = text(line.groupId) || text(payload.group_id) || text(payload.line_item_group_id) || text(nested.id);
  const groupName = text(line.groupName) || text(payload.group_name) || text(payload.group_title) || text(nested.name || nested.title) || names.get(groupId) || '';
  return { groupId, groupName: groupName || (groupId ? `Group ${groupId}` : 'Ungrouped'), missingName: !!groupId && !groupName };
}

/** A label-only enrichment must not force operators to discard saved quantities. */
export function sameAllocationSourceExceptGroupNames(a: AllocationSource, b: AllocationSource): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  const comparable = (source: AllocationSource) => canonical({ ...source, syncedAt: undefined,
    lines: source.lines.map(line => ({ ...line, groupName: undefined })) });
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}
