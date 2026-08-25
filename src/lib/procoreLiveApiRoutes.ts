const PROCORE_LIVE_API_ROUTE_PREFIXES = [
  '/api/procore/sync',
  '/api/procore/projects',
  '/api/procore/vendors',
  '/api/procore/prime-contracts',
  '/api/procore/change-order-packages',
  '/api/procore/company-users',
  '/api/procore/configurable-field-sets',
  '/api/procore/custom-fields',
  '/api/procore/project-stages',
  '/api/procore/estimating/bid-board-projects',
  '/api/procore/estimating/bid-board-project-by-id',
  '/api/procore/estimating/catalogs',
  '/api/procore/estimating/catalog-items',
  '/api/procore/estimating/estimating-project',
  '/api/procore/estimating/proposals',
  '/api/procore/estimating/proposals-bulk',
  '/api/procore/estimating/proposal-line-items',
  '/api/procore/estimating/proposal-line-items-bulk',
  '/api/procore/estimating/proposal-line-item-groups',
];

// This exact endpoint reads the canonical Analytics database. More specific
// /api/procore/projects/* routes can still call Procore and remain gated.
const DATABASE_BACKED_ROUTE_PATHS = new Set(['/api/procore/projects']);

export function isProcoreLiveApiRoutePath(pathname: string): boolean {
  if (DATABASE_BACKED_ROUTE_PATHS.has(pathname)) return false;

  return PROCORE_LIVE_API_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
