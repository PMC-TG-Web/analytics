type PurchaseOrderLaborLine = {
  projectId: string;
  costType: string | null;
};

// Use the complete saved PO population, before display filters, so searching
// for materials or switching PO status cannot bring the duplicate card back.
export function projectsWithPurchaseOrderLabor(lines: PurchaseOrderLaborLine[]): Set<string> {
  return new Set(lines
    .filter(line => /^(l|labor|labour)$/i.test(line.costType?.trim() || ''))
    .map(line => line.projectId));
}
