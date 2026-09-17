// Batch successful PO checks into table refreshes; idle checks must not cause a
// full monthly aggregation on every poll. Periodic refresh still picks up logs
// ingested by other workers and changes saved from another machine.
export function shouldRefreshBillQueue(now: number, lastRefresh: number, hasSynced: boolean) {
  return now - lastRefresh >= (hasSynced ? 60_000 : 120_000);
}

export function billSourcePollDelay(status: string) {
  return status === 'synced' ? 15_000 : 60_000;
}
