type UnknownRecord = Record<string, unknown>;

export type EstimateGroupCategory = "foundation" | "wall" | "sog" | "site" | "bollard";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function normalizeEstimateCloneText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEstimateCloneItemName(value: unknown): string {
  return normalizeEstimateCloneText(value).replace(/^\d+\s+/, "");
}

export function estimateCostItemTypeForCostCodeType(
  costCodeType: unknown,
  fallbackType: unknown = "CUSTOM"
): string {
  const normalized = normalizeEstimateCloneText(costCodeType).replace(/\s+/g, "");
  if (["l", "lab", "labor"].includes(normalized)) return "LABOR";
  if (["m", "mat", "material", "materials"].includes(normalized)) return "PART";
  if (["e", "equip", "equipment"].includes(normalized)) return "EQUIPMENT";
  if (["c", "commitment", "commitments", "s", "sub", "subcontractor", "subcontractors"].includes(normalized)) {
    return "SUBCONTRACTOR";
  }
  // Every other populated workbook value is a company-defined Cost Type.
  // It must override the source line instead of inheriting the source type.
  if (normalized) return "CUSTOM";
  return String(fallbackType || "CUSTOM").trim() || "CUSTOM";
}

export function estimateCostTypeCode(costCodeType: unknown): string {
  const normalized = normalizeEstimateCloneText(costCodeType).replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    lab: "L",
    labor: "L",
    mat: "M",
    material: "M",
    materials: "M",
    equip: "E",
    equipment: "E",
    commitment: "C",
    commitments: "C",
    sub: "S",
    subcontractor: "S",
    subcontractors: "S",
    concrete: "CON",
    other: "O",
  };
  return aliases[normalized] || String(costCodeType || "").trim().toUpperCase();
}

export function estimateCostTypeName(costCodeType: unknown): string {
  const normalized = normalizeEstimateCloneText(costCodeType).replace(/\s+/g, "");
  if (["l", "lab", "labor"].includes(normalized)) return "Labor";
  if (["m", "mat", "material", "materials"].includes(normalized)) return "Materials";
  if (["e", "equip", "equipment"].includes(normalized)) return "Equipment";
  if (["c", "commitment", "commitments"].includes(normalized)) return "Commitments";
  if (["s", "sub", "subcontractor", "subcontractors"].includes(normalized)) return "Subcontractors";
  if (["con", "concrete"].includes(normalized)) return "Concrete";
  if (["o", "other"].includes(normalized)) return "Other";
  if (normalized === "d") return "Disposable Supplies";
  if (normalized === "ls") return "Labor Laser Screeding";
  if (normalized === "oc") return "Owner Cost";
  if (normalized === "qc") return "Quality Control";
  if (normalized === "svc") return "Professional Services";
  if (normalized === "t") return "Travel";
  return String(costCodeType || "").trim();
}

export function estimateGroupCategory(groupName: unknown): EstimateGroupCategory | null {
  const value = normalizeEstimateCloneText(groupName);
  if (!value) return null;
  if (/\bbollards?\b/.test(value)) return "bollard";
  if (
    /\bsite\b|\bexterior\b|\bsidewalks?\b|\bdocks?\b|\bdumpsters?\b|\bcurbs?\b|\baprons?\b|\bstoops?\b|\bwalkways?\b|\bramps?\b|\btransformer pads?\b/.test(
      value
    )
  ) {
    return "site";
  }
  if (/\bwall\b|\bwf\d*\b/.test(value)) return "wall";
  if (/\bfootings?\b|\bfooters?\b|\bpiers?\b|\bspread\b|\bmat\b|\bfoundations?\b/.test(value)) {
    return "foundation";
  }
  if (
    /\bsog\b|\bsod\b|\bslab on grade\b|\bgarage slab\b|\bporch slabs?\b|\bslabs?\b|\bpan steps?\b|\bpit leveler\b|\brecessed floor\b/.test(
      value
    )
  ) {
    return "sog";
  }
  return null;
}

function categoryFromCostCode(value: unknown): EstimateGroupCategory | null {
  const code = String(value ?? "").trim();
  if (/^03-(?:100|200|300)-00-/.test(code)) return "foundation";
  if (/^03-(?:100|200|300)-10-/.test(code)) return "wall";
  if (/^03-(?:100|200|300)-20-/.test(code)) return "sog";
  if (/^03-(?:100|200|300)-30-/.test(code)) return "site";
  if (/^05-100-10-/.test(code)) return "bollard";
  return null;
}

function mappingCostCode(mapping: UnknownRecord): string {
  const oldRow = isRecord(mapping.old) ? mapping.old : {};
  const newRow = isRecord(mapping.new) ? mapping.new : {};
  return String(newRow["Cost Code"] || oldRow["Cost Code"] || "").trim();
}

function mappingItemName(mapping: UnknownRecord): string {
  const oldRow = isRecord(mapping.old) ? mapping.old : {};
  const newRow = isRecord(mapping.new) ? mapping.new : {};
  return normalizeEstimateCloneItemName(newRow.Name || oldRow.Name);
}

function mappingTargetItemId(mapping: UnknownRecord): string {
  const newRow = isRecord(mapping.new) ? mapping.new : {};
  return String(newRow.ItemId || "").trim();
}

export function chooseEstimateGenericCategoryMapping(
  matches: UnknownRecord[],
  sourceName: unknown,
  groupName: unknown,
  groupCostCode: unknown = ""
): UnknownRecord | null {
  const source = normalizeEstimateCloneItemName(sourceName);
  const kind = source === "labor" ? "labor" : source === "concrete" ? "concrete" : null;
  if (!kind) return null;

  const category = estimateGroupCategory(groupName) || categoryFromCostCode(groupCostCode);
  if (!category) return null;

  const desiredCode: Record<EstimateGroupCategory, Record<"labor" | "concrete", string>> = {
    foundation: { labor: "03-300-00-10", concrete: "03-300-00-20" },
    wall: { labor: "03-300-10-10", concrete: "03-300-10-20" },
    sog: { labor: "03-300-20-10", concrete: "03-300-20-20" },
    site: { labor: "03-300-30-10", concrete: "03-300-30-20" },
    bollard: { labor: "05-100-10-30", concrete: "05-100-10-20" },
  };
  const candidates = matches.filter(
    (mapping) =>
      mappingCostCode(mapping) === desiredCode[category][kind] &&
      (kind !== "concrete" || /\bconcrete\b/.test(mappingItemName(mapping)))
  );
  const uniqueTargets = new Map<string, UnknownRecord>();
  for (const candidate of candidates) {
    const targetItemId = mappingTargetItemId(candidate);
    if (targetItemId) uniqueTargets.set(targetItemId, candidate);
  }
  return uniqueTargets.size === 1 ? [...uniqueTargets.values()][0] : null;
}

function mappingCostName(mapping: UnknownRecord): string {
  const oldRow = isRecord(mapping.old) ? mapping.old : {};
  const newRow = isRecord(mapping.new) ? mapping.new : {};
  return normalizeEstimateCloneText(oldRow["Cost Name"] || newRow["Cost Name"]);
}

export function chooseEstimateMappingByGroupCategory(
  matches: UnknownRecord[],
  groupName: unknown
): UnknownRecord | null {
  if (matches.length < 2) return null;
  const category = estimateGroupCategory(groupName);
  if (!category) return null;
  const hinted = matches.filter((mapping) => {
    const costName = mappingCostName(mapping);
    if (category === "sog") return /\bsog\b|\bslab on grade\b/.test(costName);
    return new RegExp(`\\b${category}\\b`).test(costName);
  });
  return hinted.length === 1 ? hinted[0] : null;
}

function mappingDescription(mapping: UnknownRecord): string {
  const oldRow = isRecord(mapping.old) ? mapping.old : {};
  return normalizeEstimateCloneText(oldRow.Description);
}

export function chooseEstimateMappingByDescriptionPrefix(
  matches: UnknownRecord[],
  sourceDescription: unknown
): UnknownRecord | null {
  if (matches.length < 2) return null;
  const source = normalizeEstimateCloneText(sourceDescription);
  if (!source) return null;
  const hinted = matches.filter((mapping) => {
    const candidate = mappingDescription(mapping);
    return (
      candidate === source ||
      candidate.startsWith(`${source} `) ||
      source.startsWith(`${candidate} `)
    );
  });
  return hinted.length === 1 ? hinted[0] : null;
}
