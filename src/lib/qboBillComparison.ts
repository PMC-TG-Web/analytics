export type BillMapping = {
  companyId: string; projectId: string; environment: string; realmId: string;
  vendorId?: string; customerId?: string; customerFullyQualifiedName?: string; customerName: string;
  items: Record<string, { itemName: string; itemId?: string; uom?: string; classId?: string; offsetCategory?: string }>;
  offsets?: { customerAssignment: string; material?: Offset; labor?: Offset };
};
type Offset = { accountId?: string; accountName: string; classId?: string | null; className?: string };
export type ComparisonDraft = { projectNumber?: string | null; month: string; issues: string[]; lines: { lineKey: string; sourceType: string; description: string; costCode: string | null; costType: string | null; quantity: string; unitCost: string; amount: string; uom: string }[] };
type Detail = { ItemRef?: { value: string }; AccountRef?: { value: string }; CustomerRef?: { value: string }; ClassRef?: { value: string }; Qty?: number; UnitPrice?: number; BillableStatus?: string };
export type SavedBill = { VendorRef?: { value: string }; Line?: { DetailType: string; Description?: string; Amount: number; ItemBasedExpenseLineDetail?: Detail; AccountBasedExpenseLineDetail?: Detail }[] };
function normalized(bill: SavedBill) {
  return JSON.stringify({ vendor: bill.VendorRef?.value, lines: (bill.Line || []).map(l => {
    const d = l.ItemBasedExpenseLineDetail || l.AccountBasedExpenseLineDetail || {};
    return [l.DetailType, l.Description || '', l.Amount, d.ItemRef?.value || '', d.AccountRef?.value || '', d.CustomerRef?.value || '', d.ClassRef?.value || '', d.Qty ?? null, d.UnitPrice ?? null, d.BillableStatus || ''];
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
}

export function compareMonthlyBill(draft: ComparisonDraft, mapping: BillMapping, saved?: SavedBill) {
  const issues = [...draft.issues];
  const projectNumber = draft.projectNumber?.trim();
  if (!projectNumber) issues.push('Procore project number is required for product naming.');
  const bill: SavedBill = { VendorRef: { value: mapping.vendorId || '' }, Line: [] };
  if (!/^\d+$/.test(mapping.vendorId || '') || !/^\d+$/.test(mapping.customerId || '')) issues.push('Vendor / project mapping is incomplete.');
  if (draft.lines.length > 500) issues.push('The monthly bill exceeds the supported 500 cost lines.');
  const totals = { material: 0, labor: 0 };
  for (const line of draft.lines) {
    const item = mapping.items?.[line.lineKey];
    const prefix = `${projectNumber}-${line.costCode}.`;
    if (!/^\d+$/.test(item?.itemId || '') || item?.uom !== line.uom || !item?.itemName?.startsWith(prefix) || !/^[A-Z0-9]+$/.test(item.itemName.slice(prefix.length))) issues.push(`Product mapping needed for ${line.costCode || line.description}.`);
    const kind = line.sourceType === 'timecard' || /^(labor|l)$/i.test(line.costType?.trim() || '') ? 'labor' : /^(materials?|m)$/i.test(line.costType?.trim() || '') || (/^(other|o|equipment|e|commitments|c)$/i.test(line.costType?.trim() || '') && item?.offsetCategory === 'material') ? 'material' : null;
    if (!kind) issues.push(`Offset category needed for ${line.description}.`);
    else totals[kind] += Math.round(Number(line.amount) * 100);
    bill.Line!.push({ DetailType: 'ItemBasedExpenseLineDetail', Description: `${line.description} (${line.uom})`, Amount: Number(line.amount), ItemBasedExpenseLineDetail: { ItemRef: { value: item?.itemId || '' }, Qty: Number(line.quantity), UnitPrice: Number(line.unitCost), CustomerRef: { value: mapping.customerId || '' }, BillableStatus: 'NotBillable', ...(item?.classId ? { ClassRef: { value: item.classId } } : {}) } });
  }
  if (mapping.offsets?.customerAssignment !== 'none') issues.push('Configure category offsets with no Customer / Project.');
  for (const kind of ['material', 'labor'] as const) {
    if (!totals[kind]) continue;
    const offset = mapping.offsets?.[kind];
    if (!/^\d+$/.test(offset?.accountId || '') || offset?.accountName !== (kind === 'material' ? 'Direct Costs -' : 'Labor -') || (offset?.classId !== null && !/^\d+$/.test(offset?.classId || ''))) issues.push(`Configure the ${kind} offset account and class.`);
    bill.Line!.push({ DetailType: 'AccountBasedExpenseLineDetail', Description: `${draft.month} Procore ${kind} offset`, Amount: -totals[kind] / 100, AccountBasedExpenseLineDetail: { AccountRef: { value: offset?.accountId || '' }, BillableStatus: 'NotBillable', ...(offset?.classId ? { ClassRef: { value: offset.classId } } : {}) } });
  }
  return { issues: [...new Set(issues)], unchanged: !!saved?.Line && normalized(saved) === normalized(bill), previousGross: saved?.Line ? saved.Line.filter(l => l.DetailType === 'ItemBasedExpenseLineDetail').reduce((n, l) => n + Math.round(l.Amount * 100), 0) / 100 : null };
}
