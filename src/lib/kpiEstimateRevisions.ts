export type EstimateRevisionVersion = {
  proposalId: string;
  name: string;
  primary: boolean;
  order?: number | null;
  alternate?: boolean;
  isBaselineCandidate?: boolean;
  /** Procore creation time, never the local mirror row's insertion time. */
  sourceCreatedAt?: string | null;
  updatedAt: string | null;
  hours: number | null;
  sales: number | null;
};
export type EstimateRevisionEvent = {
  date: string;
  kind: 'initial' | 'rebid';
  basis?: 'same-month-primary' | 'original-estimate' | 'first-created-estimate';
  hours: number | null;
  sales: number | null;
  previous: EstimateRevisionVersion | null;
  revised: EstimateRevisionVersion | null;
};
const round = (value: number, digits: number) => Number(value.toFixed(digits));
const valid = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0;

export function estimateRevisionDate(timestamp: string | null): string | null {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}

/** The original stays in the project's Created Date month. Versions updated
 * within that initial month count the unique primary once. Later revisions
 * always compare with the named original, or the first source-created estimate.
 * Display order, proposal IDs and local ingestion times cannot establish creation.
 */
export function calculateEstimateRevisions(createdDate: string, versions: EstimateRevisionVersion[]) {
  const estimates = versions.filter(version => !version.alternate);
  const primaries = estimates.filter(version => version.primary);
  const primary = primaries.length === 1 ? primaries[0] : null;
  const issues: string[] = [];
  const unavailable = (): EstimateRevisionEvent[] => [{ date: createdDate, kind: 'initial', hours: null, sales: null, previous: null, revised: primary }];
  if (!primary) return { events: unavailable(), issues: ['A unique primary estimate is required.'], primary };
  const snapshot = (version: EstimateRevisionVersion) => ({ hours: valid(version.hours) ? round(version.hours!, 4) : null, sales: valid(version.sales) ? round(version.sales!, 2) : null });
  const current = snapshot(primary);
  if (current.hours === null) issues.push('Primary estimate hours are unavailable.');
  if (current.sales === null) issues.push('Primary estimate dollars are unavailable.');
  if (estimates.length === 1) {
    return { events: [{ date: createdDate, kind: 'initial' as const, ...current, previous: null, revised: primary }], issues, primary };
  }
  const revisionDate = estimateRevisionDate(primary.updatedAt);
  const revisionMonth = revisionDate?.slice(0, 7);
  // Count the full primary once only in the project's initial month. Editing
  // every version in a later month must never move the original amount there.
  if (revisionDate && revisionMonth && revisionMonth === createdDate.slice(0, 7)
    && estimates.every(version => estimateRevisionDate(version.updatedAt)?.slice(0, 7) === revisionMonth)) {
    const event: EstimateRevisionEvent = { date: createdDate,
      kind: 'initial', basis: 'same-month-primary',
      ...current, previous: null, revised: primary };
    return { events: [event], issues, primary };
  }
  const originals = estimates.filter(version => version.isBaselineCandidate);
  let previous: EstimateRevisionVersion;
  let basis: 'original-estimate' | 'first-created-estimate';
  if (originals.length === 1) {
    previous = originals[0];
    basis = 'original-estimate';
  } else if (originals.length > 1) {
    return { events: unavailable(), issues: [...issues, 'More than one estimate is marked as an original or baseline; the original estimate is ambiguous.'], primary };
  } else {
    const byCreation = estimates.map(version => ({ version, time: Date.parse(version.sourceCreatedAt ?? '') }))
      .sort((a, b) => a.time - b.time);
    if (byCreation.some(row => !Number.isFinite(row.time)) || byCreation[0].time === byCreation[1].time) {
      return { events: unavailable(), issues: [...issues, 'No original estimate is identified, and source creation dates do not identify a unique first estimate.'], primary };
    }
    previous = byCreation[0].version;
    basis = 'first-created-estimate';
  }
  if (previous.proposalId === primary.proposalId) {
    return { events: [{ date: createdDate, kind: 'initial' as const, basis, ...current, previous: null, revised: primary }], issues, primary };
  }
  if (!revisionDate || revisionDate < createdDate) {
    return { events: unavailable(), issues: [...issues, 'The primary estimate needs a valid source update date on or after project creation to assign the rebid month.'], primary };
  }
  const prior = snapshot(previous);
  if (prior.hours === null) issues.push('Baseline estimate hours are unavailable; the hour change cannot be calculated.');
  if (prior.sales === null) issues.push('Baseline estimate dollars are unavailable; the dollar change cannot be calculated.');
  return {
    events: [
      { date: createdDate, kind: 'initial' as const, basis, ...prior, previous: null, revised: previous },
      { date: revisionDate, kind: 'rebid' as const, basis,
        hours: current.hours !== null && prior.hours !== null ? round(current.hours - prior.hours, 4) : null,
        sales: current.sales !== null && prior.sales !== null ? round(current.sales - prior.sales, 2) : null,
        previous, revised: primary },
    ], issues, primary,
  };
}
