export type Segment = { id: number; code: string; path_code?: string; status: string; is_parent?: boolean; segment: { id: number; type: string } };
export type Wbs = { id: number; flat_code: string; status: string; segment_items: Segment[] };
export type Budget = { id: number; wbs_code: { id: number; flat_code: string }; original_budget_amount: string };
export type BudgetPending = { code: string; kind: 'wbs' | 'budget' };
export function recentBudgetCodesCover(codes: string[], rows: { code: string; verifiedAt: Date | string }[], now = Date.now()) {
  return codes.length > 0 && codes.every(code => {
    const matches = rows.filter(row => row.code === code);
    if (matches.length !== 1) return false;
    const age = now - new Date(matches[0].verifiedAt).getTime();
    return Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60_000;
  });
}
type Ports = {
  budgets: () => Promise<Budget[]>;
  wbs: () => Promise<Wbs[]>;
  segments: (id: number) => Promise<Segment[]>;
  createWbs: (body: { segment_items: { segment_id: number; segment_item_id: number }[] }) => Promise<Wbs>;
  createBudget: (wbsId: number) => Promise<Budget>;
  pending: BudgetPending | null;
  savePending: (pending: BudgetPending | null) => Promise<void>;
};

export function budgetCodesForProducts(projectNumber: string, names: string[]) {
  if (!projectNumber?.trim() || !names.length || names.length > 500) throw new Error('Current project products are required for the Procore budget check.');
  const prefix = `${projectNumber.trim()}-`;
  return [...new Set(names.map(name => {
    const code = name.startsWith(prefix) ? name.slice(prefix.length) : '';
    if (!/^\d{2}-\d{3}-\d{2}-\d{2}\.[A-Z0-9]+$/.test(code)) throw new Error(`Cannot check the Procore budget for product ${name}: its project prefix or cost code differs.`);
    return code;
  }))].sort();
}

// One code per continuation. Always read live before deciding to create; never
// replay an uncertain mutation simply because its response was lost.
export async function ensureBudgetCodeStep(codes: string[], io: Ports) {
  const budget = await io.budgets();
  for (const code of codes) if (budget.filter(b => b.wbs_code?.flat_code === code).length > 1) throw new Error(`Duplicate Procore budget entries for ${code}.`);
  let pending = io.pending;
  if (pending?.kind === 'budget') {
    if (!budget.some(b => b.wbs_code?.flat_code === pending!.code)) throw new Error(`Procore has not confirmed the previous budget creation for ${pending.code}. Check that operation before retrying; no duplicate was submitted.`);
    await io.savePending(null); pending = null;
  }
  const missing = codes.filter(code => !budget.some(b => b.wbs_code?.flat_code === code));
  if (!missing.length && !pending) return { ready: true, remaining: 0, message: 'Procore budget codes are ready. ERP import is checked separately.' };
  const wbs = await io.wbs();
  if (pending) {
    if (!wbs.some(w => w.flat_code === pending!.code && w.status === 'active')) throw new Error(`Procore has not confirmed the previous WBS creation for ${pending.code}. Check that operation before retrying; no duplicate was submitted.`);
    await io.savePending(null);
  }
  if (!missing.length) return { ready: true, remaining: 0, message: 'Procore budget codes are ready. ERP import is checked separately.' };
  const code = missing[0];
  const matches = wbs.filter(w => w.flat_code === code);
  if (matches.length > 1 || (matches[0] && matches[0].status !== 'active')) throw new Error(`Review the inactive or duplicate Procore WBS code ${code}.`);
  let selected = matches[0];
  if (!selected) {
    const [cost, type] = code.split('.');
    const template = wbs.find(w => w.status === 'active' && w.segment_items.length === 2 && w.segment_items.some(s => s.segment.type === 'cost_code') && w.segment_items.some(s => s.segment.type === 'line_item_type'));
    if (!template) throw new Error(`Cannot automatically add ${code}: this project needs its standard cost-code and cost-type segments configured.`);
    const costSegment = template.segment_items.find(s => s.segment.type === 'cost_code')!.segment.id;
    const typeSegment = template.segment_items.find(s => s.segment.type === 'line_item_type')!.segment.id;
    const costs = await io.segments(costSegment);
    const types = await io.segments(typeSegment);
    const costItems = costs.filter(s => s.path_code === cost && s.status === 'active' && !s.is_parent);
    const typeItems = types.filter(s => s.code === type && s.status === 'active' && !s.is_parent);
    if (costItems.length !== 1 || typeItems.length !== 1) throw new Error(`Add ${code} from the QuickBooks ERP standard cost-code list to this Procore project's WBS. Its required code or type is missing or ambiguous.`);
    await io.savePending({ code, kind: 'wbs' });
    selected = await io.createWbs({ segment_items: [{ segment_id: costSegment, segment_item_id: costItems[0].id }, { segment_id: typeSegment, segment_item_id: typeItems[0].id }] });
    if (selected.flat_code !== code || selected.status !== 'active') throw new Error(`Procore returned an unexpected WBS code for ${code}.`);
    await io.savePending(null);
    // Yield between WBS and budget mutations to bound the server request.
    return { ready: false, remaining: missing.length, message: `Prepared ${code} in Procore. Adding its zero-dollar budget entry...` };
  }
  await io.savePending({ code, kind: 'budget' });
  const created = await io.createBudget(selected.id);
  if (String(created.wbs_code?.id) !== String(selected.id) || created.wbs_code?.flat_code !== code || Number(created.original_budget_amount) !== 0) throw new Error(`Procore returned an unexpected budget entry for ${code}.`);
  await io.savePending(null);
  return { ready: false, remaining: missing.length - 1, message: `Added ${code} to the Procore budget at $0. Checking remaining codes...` };
}
