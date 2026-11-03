export type EstimateRevisionVersion = {
  proposalId: string;
  name: string;
  primary: boolean;
  order?: number | null;
  alternate?: boolean;
  updatedAt: string | null;
  hours: number | null;
  sales: number | null;
};
export type EstimateRevisionEvent = {
  date: string;
  kind: 'initial' | 'rebid';
  basis?: 'same-month-primary';
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

/** Same-month versions count the unique primary once. Across different months,
 * version order AND source time must advance for the previous-version delta;
 * neither identifies the former primary among several earlier proposals.
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
  // Owner's rule: changes in one Eastern calendar month use the full primary,
  // regardless of intermediate copies, amounts, or ordering within that month.
  // An older Created Date must not move this month's activity back into history.
  if (revisionDate && revisionMonth && revisionMonth >= createdDate.slice(0, 7)
    && estimates.every(version => estimateRevisionDate(version.updatedAt)?.slice(0, 7) === revisionMonth)) {
    const initialMonth = createdDate.slice(0, 7) === revisionMonth;
    const event: EstimateRevisionEvent = { date: initialMonth ? createdDate : revisionDate,
      kind: initialMonth ? 'initial' : 'rebid', basis: 'same-month-primary',
      ...current, previous: null, revised: primary };
    return { events: [event], issues, primary };
  }
  if (estimates.length !== 2) return { events: unavailable(), issues: [...issues, 'More than one previous estimate exists; the previous primary and intermediate rebids need review.'], primary };
  const previous = estimates.find(version => !version.primary)!;
  const previousDate = estimateRevisionDate(previous.updatedAt);
  const timeAdvanced = revisionDate && previousDate && Date.parse(primary.updatedAt!) > Date.parse(previous.updatedAt!);
  const orderAdvanced = primary.order != null && previous.order != null && primary.order > previous.order;
  if (!timeAdvanced || !orderAdvanced || revisionDate < createdDate) {
    return { events: unavailable(), issues: [...issues, 'The primary is not clearly newer in both version order and source update date; confirm the previous estimate and rebid month.'], primary };
  }
  const prior = snapshot(previous);
  if (prior.hours === null) issues.push('Previous estimate hours are unavailable; the hour change cannot be calculated.');
  if (prior.sales === null) issues.push('Previous estimate dollars are unavailable; the dollar change cannot be calculated.');
  return {
    events: [
      { date: createdDate, kind: 'initial' as const, ...prior, previous: null, revised: previous },
      { date: revisionDate, kind: 'rebid' as const,
        hours: current.hours !== null && prior.hours !== null ? round(current.hours - prior.hours, 4) : null,
        sales: current.sales !== null && prior.sales !== null ? round(current.sales - prior.sales, 2) : null,
        previous, revised: primary },
    ], issues, primary,
  };
}
