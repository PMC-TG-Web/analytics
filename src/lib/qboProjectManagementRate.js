export const PROJECT_MANAGEMENT_COST_CODE = '01-300-10-20';

/** @param {{ costCode?: string | null, costType?: string | null, uom?: string | null }} source */
export function projectManagementPrice(source) {
  const code = String(source.costCode || '').trim().replace(/\.L$/i, '');
  if (code !== PROJECT_MANAGEMENT_COST_CODE || !/^(labor|l)$/i.test((source.costType || '').trim())
    || !/^(h|hr|hrs|hour|hours|ea|each)$/i.test((source.uom || '').trim())) return null;
  // Explicit billing policy; this is not a Procore catalog price.
  // Legacy PM PO lines label their logged hours ea; quantities are not converted.
  return { policy: 'project-management-hourly-v1', costCode: code, unitCost: '55', uom: 'hr', sourceUom: source.uom.trim().toLowerCase() };
}
