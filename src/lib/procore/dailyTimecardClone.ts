export function countTimecardOccurrences(keys: string[]) {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function allocateExistingTimecardRows<
  T extends {
    timecardExactKey: string;
    timecardIdentityKey: string;
  },
>(
  rows: T[],
  existingExactCounts: Map<string, number>,
  existingIdentityCounts: Map<string, number>,
) {
  const usedExactCounts = new Map<string, number>();
  const usedIdentityCounts = new Map<string, number>();

  return rows.map((row) => {
    const exactKey = row.timecardExactKey;
    const identityKey = row.timecardIdentityKey;
    const usedExact = usedExactCounts.get(exactKey) || 0;
    const usedIdentity = usedIdentityCounts.get(identityKey) || 0;
    const existingExact = existingExactCounts.get(exactKey) || 0;
    const existingIdentity = existingIdentityCounts.get(identityKey) || 0;

    const existingTargetTimecardExact = Boolean(exactKey && usedExact < existingExact);
    const existingTargetTimecardIdentityConflict = Boolean(
      identityKey &&
        !existingTargetTimecardExact &&
        usedIdentity < existingIdentity,
    );

    if (existingTargetTimecardExact) {
      usedExactCounts.set(exactKey, usedExact + 1);
      if (identityKey) usedIdentityCounts.set(identityKey, usedIdentity + 1);
    } else if (existingTargetTimecardIdentityConflict) {
      usedIdentityCounts.set(identityKey, usedIdentity + 1);
    }

    return {
      ...row,
      existingTargetTimecardExact,
      existingTargetTimecardIdentityConflict,
      existingTargetTimecard:
        existingTargetTimecardExact || existingTargetTimecardIdentityConflict,
    };
  });
}
