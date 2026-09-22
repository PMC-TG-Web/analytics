const GENERIC_DRAFT_ISSUE = 'Resolve draft issues before creating a bill.';

/** Replace the host's summary error with the actionable draft issues, retaining every other blocker. */
export function actionableBillIssues(draftIssues: string[], reviewIssues: string[]) {
  return [...new Set([...draftIssues, ...reviewIssues.filter(issue =>
    issue !== GENERIC_DRAFT_ISSUE || draftIssues.length === 0)])];
}
