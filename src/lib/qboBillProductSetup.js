/**
 * Shared by the worklist, individual review and durable batch worker.
 * Only known setup issues can enter automatic product setup.
 * @param {{lines: {lineKey: string}[], issues: string[]}} draft
 * @param {{action?: string, products?: Record<string, string>, issues: string[]}} review
 */
export function billProductSetupNeeded(draft, review) {
  if (draft.issues.length || !draft.lines.length || review.action === 'reconcile') return false;
  const mappingUpdate = issue => /^QBO product mapping for .+ (?:needs updating: saved product .+ must use .+|needs the \.LS suffix)\. Run Set up products to refresh the assignment\.$/i.test(issue);
  const missing = draft.lines.some(line => !review.products?.[line.lineKey]);
  return (missing || review.issues.some(mappingUpdate))
    && review.issues.every(issue => /Missing QBO item mapping|QBO product setup needed/i.test(issue) || mappingUpdate(issue));
}
