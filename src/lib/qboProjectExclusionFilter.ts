export function normalizeQboCustomerId(value: unknown) {
  return String(value || "").trim();
}

export function excludeMarkedQboProjects<T extends { qboCustomerId: unknown }>(
  rows: T[],
  excludedCustomerIds: Iterable<string>,
) {
  const excluded = new Set(
    [...excludedCustomerIds].map(normalizeQboCustomerId).filter(Boolean),
  );
  return rows.filter((row) => !excluded.has(normalizeQboCustomerId(row.qboCustomerId)));
}
