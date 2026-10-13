/** @param {string | null | undefined} costCode @param {string | null | undefined} description */
export function isShopDrawingCost(costCode, description) {
  return String(costCode || '').trim().replace(/\.[A-Z]+$/i, '') === '01-300-10-40'
    || /\bshop\s+drawings?\b/i.test(String(description || '').normalize('NFKC'));
}

/** Vendor equipment is invoiced separately, regardless of the PO's code/type.
 * This predicate is for productivity/PO descriptions, never employee timecards.
 * @param {string | null | undefined} description
 */
export function isVendorPumpingOrTrailer(description) {
  return /\b(?:tele[\s-]*belts?|pumps?|pumping|trailers?)\b/i.test(
    String(description || '').normalize('NFKC'),
  );
}
