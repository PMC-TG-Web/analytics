type RecordValue = Record<string, unknown>;

type ImportState = {
  fingerprint: string;
  status: string;
  targets: Array<{ id: string; name: string; number: string }>;
};

/** A timeout is never permission to replay a write. Only durable completion
 * for the exact preview, with an audit for every claimed PO, proves success. */
export function primaryEstimateCreationStatus(
  state: ImportState | null,
  fingerprint: string,
  audits: Array<{ entityId: string | null; changes: unknown }>,
) {
  if (!state || state.fingerprint !== fingerprint) return { creationStatus: 'unknown' };
  if (state.status === 'running') return { creationStatus: 'processing' };
  if (state.status !== 'completed' || !state.targets.length) return { creationStatus: 'unknown' };
  const results: RecordValue[] = [];
  for (const target of state.targets) {
    const audit = audits.find(row => {
      const changes = row.changes as RecordValue | null;
      return row.entityId === target.id && changes?.success === true && changes.status === 'Approved'
        && !changes.sourceChangeOrder && changes.group === target.name;
    });
    if (!audit) return { creationStatus: 'processing' };
    const changes = audit.changes as RecordValue;
    results.push({ success: true, group: target.name, number: target.number, contractId: target.id,
      status: 'Approved', createdContract: changes.createdContract === true,
      createdLineItems: Number(changes.createdLineItems) || 0, reusedLineItems: Number(changes.reusedLineItems) || 0 });
  }
  return { creationStatus: 'completed', success: true, mode: 'create', results,
    created: results.filter(row => row.createdContract).length,
    resumed: results.filter(row => !row.createdContract).length, addedToExisting: 0, failed: 0, outcomeUnknown: false };
}
