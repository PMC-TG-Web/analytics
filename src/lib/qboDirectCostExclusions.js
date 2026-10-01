/** @param {string | null | undefined} costCode @param {string | null | undefined} description */
export function isShopDrawingCost(costCode, description) {
  return String(costCode || '').trim().replace(/\.[A-Z]+$/i, '') === '01-300-10-40'
    || /\bshop\s+drawings?\b/i.test(String(description || '').normalize('NFKC'));
}
