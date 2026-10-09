import type { CatalogMappingSource } from './qboCatalogMapping';
export type ProjectPriceEvidence = { companyId: string; projectId: string; lineKey: string; unitCost: string; sourceSignature: string; revision: number; updatedBy: string; reason: string };
export type BillLineRule = { companyId: string; projectId: string; lineKey: string; sourceSignature: string; ignored: boolean; unitCost: { toString(): string } | string | null; revision: number; updatedBy: string; reason: string };
export function projectPrice(source: CatalogMappingSource, rule: BillLineRule | undefined) {
 if (!rule || rule.unitCost === null) return null;
 // The caller scopes rules by company, project and immutable PO line ID. Keep
 // the operator's price until changed, just like an explicit catalog mapping.
 // Source signatures still protect concurrent edits when saving a setting.
 const unitCost = rule.unitCost.toString();
 if (!/^\d{1,10}(\.\d{1,8})?$/.test(unitCost) || Number(unitCost) <= 0) return { issue: `${source.description}: project price must be positive.` };
 return { unitCost: Number(unitCost), evidence: { companyId:rule.companyId,projectId:rule.projectId,lineKey:rule.lineKey,unitCost,sourceSignature:rule.sourceSignature,revision:rule.revision,updatedBy:rule.updatedBy,reason:rule.reason } satisfies ProjectPriceEvidence };
}
