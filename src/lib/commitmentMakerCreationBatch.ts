export class CommitmentMakerBatchPending extends Error {
  constructor() { super('Creation will continue from saved progress.'); }
}

/** Yield only between confirmed operations, never interrupt an in-flight write. */
export function commitmentMakerCreationBatch(enabled: boolean, now: () => number = Date.now) {
  const deadline = now() + 15_000;
  return () => { if (enabled && now() >= deadline) throw new CommitmentMakerBatchPending(); };
}
