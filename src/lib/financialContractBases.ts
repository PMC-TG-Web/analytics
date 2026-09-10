type PrimeContractMirror = {
  company_id: string | null;
  prime_contract_id: string;
  project_id: string | null;
  project_procore_id: string | null;
  status: string | null;
  payload: unknown;
};

// Both project ID columns are populated with the external Procore project ID
// by the prime-contract sync. Never resolve these records by project name.
export function financialContractBases(rows: PrimeContractMirror[], companyId: string) {
  const bases = new Map<string, number | null>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.company_id !== companyId) continue;
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload as Record<string, unknown> : {};
    if (payload.deleted_at || !["approved", "executed"].includes(String(row.status || "").trim().toLowerCase())) continue;
    const projectId = String(row.project_procore_id || row.project_id || "").trim();
    if (!projectId || !row.prime_contract_id || seen.has(row.prime_contract_id)) continue;
    seen.add(row.prime_contract_id);

    // grand_total is the original contract. revised_contract_amount already
    // includes COs, which Financial WIP adds from the newer approved-CO mirror.
    const raw = payload.grand_total;
    const amount = raw == null || String(raw).trim() === "" ? NaN : Number(raw);
    const previous = bases.get(projectId);
    bases.set(projectId, previous === null || !Number.isFinite(amount)
      ? null : (previous ?? 0) + amount);
  }
  for (const [id, amount] of bases) {
    if (amount != null) bases.set(id, Math.round((amount + Number.EPSILON) * 100) / 100);
  }
  return bases;
}
