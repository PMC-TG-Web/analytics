export type CommitmentVendorAssignment = {
  sourceContractId?: unknown;
  sourceNumber?: unknown;
  sourceTitle?: unknown;
  sourceVendorId?: unknown;
  sourceVendorName?: unknown;
  targetVendorId?: unknown;
};

export type TargetVendor = {
  id?: unknown;
  name?: unknown;
};

export type CommitmentVendorIssue = {
  type: "target_vendor_not_found" | "vendor_name_mismatch" | "inconsistent_vendor_mapping";
  field: "vendor_id";
  sourceContractId: string;
  sourceNumber: string;
  sourceTitle: string;
  sourceVendorId: string;
  sourceVendorName: string;
  targetVendorId: string;
  targetVendorName?: string;
  mappedTargetVendorIds?: string[];
};

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function normalizeCommitmentVendorName(value: unknown) {
  return text(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(limited liability company|llc|incorporated|inc|corporation|corp|company|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateCommitmentVendorAssignments(
  assignments: CommitmentVendorAssignment[],
  targetVendors: TargetVendor[]
) {
  const targetById = new Map(
    targetVendors
      .map((vendor) => [text(vendor.id), vendor] as const)
      .filter(([id]) => Boolean(id))
  );
  const targetIdsBySourceVendorName = new Map<string, Set<string>>();

  for (const assignment of assignments) {
    const sourceNameKey = normalizeCommitmentVendorName(assignment.sourceVendorName);
    const targetVendorId = text(assignment.targetVendorId);
    if (!sourceNameKey || !targetVendorId) continue;
    const ids = targetIdsBySourceVendorName.get(sourceNameKey) || new Set<string>();
    ids.add(targetVendorId);
    targetIdsBySourceVendorName.set(sourceNameKey, ids);
  }

  const issues: CommitmentVendorIssue[] = [];
  for (const assignment of assignments) {
    const sourceContractId = text(assignment.sourceContractId);
    const sourceNumber = text(assignment.sourceNumber);
    const sourceTitle = text(assignment.sourceTitle);
    const sourceVendorId = text(assignment.sourceVendorId);
    const sourceVendorName = text(assignment.sourceVendorName);
    const targetVendorId = text(assignment.targetVendorId);
    if (!targetVendorId) continue;

    const targetVendor = targetById.get(targetVendorId);
    if (!targetVendor) {
      issues.push({
        type: "target_vendor_not_found",
        field: "vendor_id",
        sourceContractId,
        sourceNumber,
        sourceTitle,
        sourceVendorId,
        sourceVendorName,
        targetVendorId,
      });
      continue;
    }

    const targetVendorName = text(targetVendor.name);
    const sourceNameKey = normalizeCommitmentVendorName(sourceVendorName);
    const targetNameKey = normalizeCommitmentVendorName(targetVendorName);
    if (sourceNameKey && targetNameKey && sourceNameKey !== targetNameKey) {
      issues.push({
        type: "vendor_name_mismatch",
        field: "vendor_id",
        sourceContractId,
        sourceNumber,
        sourceTitle,
        sourceVendorId,
        sourceVendorName,
        targetVendorId,
        targetVendorName,
      });
    }

    const mappedTargetVendorIds = sourceNameKey
      ? Array.from(targetIdsBySourceVendorName.get(sourceNameKey) || [])
      : [];
    if (mappedTargetVendorIds.length > 1) {
      issues.push({
        type: "inconsistent_vendor_mapping",
        field: "vendor_id",
        sourceContractId,
        sourceNumber,
        sourceTitle,
        sourceVendorId,
        sourceVendorName,
        targetVendorId,
        targetVendorName,
        mappedTargetVendorIds: mappedTargetVendorIds.sort(),
      });
    }
  }

  return issues;
}
