/** Reject a broken project export without changing the immutable snapshot. */
export function isIncompleteQboSnapshot(sourceCounts: unknown, projectRowCount: number): boolean {
  const counts = sourceCounts && typeof sourceCounts === 'object'
    ? sourceCounts as Record<string, unknown>
    : {};
  return Number(counts.procoreProjects || 0) > 0 && projectRowCount === 0;
}
