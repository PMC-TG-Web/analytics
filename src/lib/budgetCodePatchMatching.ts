type BudgetCodeWorkbookRow = {
  Name: string;
  "Cost Code": string;
  "Cost code type": string;
  "Cost Name": string;
  Description: string;
};

function normalize(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function uniqueByIdentity<T>(rows: T[], identity: (row: T) => unknown): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = String(identity(row) || "").trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function fixedBudgetCodeMappingForDescription(description: unknown): BudgetCodeWorkbookRow | null {
  if (normalize(description) !== "overhead & profit.other") return null;
  return {
    Name: "Overhead & Profit",
    "Cost Code": "90-100-10-10",
    "Cost code type": "O",
    "Cost Name": "Overhead & Profit",
    Description: "Overhead & Profit.Other",
  };
}

export function procoreFlatCostType(value: unknown) {
  const normalized = normalize(value).replace(/\s+/g, "");
  if (["s", "sub", "subcontract", "subcontractor", "subcontractors"].includes(normalized)) return "S";
  if (["c", "commitment", "commitments"].includes(normalized)) return "C";
  if (["con", "conc", "concrete"].includes(normalized)) return "CON";
  if (["l", "lab", "labor"].includes(normalized)) return "L";
  if (["m", "mat", "material", "materials"].includes(normalized)) return "M";
  if (["o", "other"].includes(normalized)) return "O";
  return String(value || "").trim().toUpperCase();
}

export function canRunLiveBudgetCodePatch(
  counts: { patchable?: unknown; missingWbsCodes?: unknown } | null | undefined,
  ensureMissingCodes: boolean
) {
  const patchable = Number(counts?.patchable || 0);
  const missingWbsCodes = Number(counts?.missingWbsCodes || 0);
  return patchable > 0 || (ensureMissingCodes && missingWbsCodes > 0);
}
