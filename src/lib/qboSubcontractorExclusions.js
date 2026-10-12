// Subcontract labor is paid through supplier invoices, not internal cost bills.
const worker = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, '').trim();

/** @param {{party?: string|null, partyName?: string|null}} entry */
export function isSubcontractorTimecard(entry) {
  return [entry.party, entry.partyName].some(value => /^subcontractors?$/.test(worker(value)));
}

/** Match explicit subcontract labor labels, never the broad equipment cost type. @param {string|null|undefined} description */
export function isSubcontractorProductivity(description) {
  const name = String(description || '').normalize('NFKC').toLowerCase()
    .replace(/^\s*#\d+\s*[-–—]\s*/, '')
    .replace(/^\s*co\s*\d+\s*[-–—]\s*/, '')
    .replace(/sub[\s-]+contractor/g, 'subcontractor').replace(/\s+/g, ' ').trim();
  return /^subcontractors?(?:\s+(?:hours?|labor|labour))?(?:$|\s*[-–—.(])/.test(name);
}
