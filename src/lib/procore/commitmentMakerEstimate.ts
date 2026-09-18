import {
  combineCommitmentMakerGroups,
  consolidateCommitmentMakerLineItems,
  isCommitmentMakerExcludedLine,
  isCommitmentMakerEstimateMatchingLine,
  normalizeCommitmentMakerCostType,
  type CommitmentMakerGroup,
  type CommitmentMakerParseResult,
} from './commitmentMaker';

type RecordValue = Record<string, unknown>;
export const estimateRecord = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

export class PrimaryEstimateError extends Error {
  readonly status = 409;
}

/** Only Procore's explicit flag is authoritative; price, name and recency are not. */
export function selectPrimaryCommitmentEstimate(proposals: RecordValue[]): RecordValue {
  const primary = proposals.filter(proposal => proposal.is_primary === true
    && text(proposal.type).toUpperCase() === 'ESTIMATE');
  if (primary.length !== 1) throw new PrimaryEstimateError(primary.length
    ? 'More than one estimate is marked Primary in Procore. Correct the primary selection in Bid Board, then refresh.'
    : 'No primary estimate is marked in Procore. Mark the intended estimate as Primary in Bid Board, then refresh.');
  if (!text(primary[0].id)) throw new PrimaryEstimateError('The primary estimate has no usable Procore ID.');
  return primary[0];
}

export function selectCommitmentEstimateBoard(ids: Array<string | null | undefined>): string {
  const unique = [...new Set(ids.map(id => text(id)).filter(Boolean))];
  if (unique.length !== 1 || !/^\d+$/.test(unique[0])) throw new PrimaryEstimateError(unique.length
    ? 'This project has conflicting Bid Board links. Correct its project link before importing the primary estimate.'
    : 'This project has no linked Bid Board estimate. Link the Bid Board job to this Procore project first.');
  return unique[0];
}

function costCode(value: unknown): string {
  const code = estimateRecord(value);
  return text(code.full_code || code.code || code.flat_code || value);
}

/** Estimate-specific assignments take precedence over the linked catalog default. */
export function primaryEstimateCostAssignment(line: RecordValue) {
  const item = estimateRecord(line.cost_item);
  const budget = estimateRecord(line.budget_code);
  const lineCode = costCode(line.cost_code) || costCode(budget) || costCode(line.wbs_code);
  const code = lineCode || costCode(item.cost_code);
  const explicitType = estimateRecord(line.cost_code_type);
  const type = text(explicitType.code || explicitType.name || line.cost_code_type || line.cost_type_code)
    || (code.includes('.') ? code.split('.').at(-1) : '')
    || (!lineCode ? text(item.cost_type_code) : '') || 'M';
  return { code, type };
}

/** Only copy coding fields from the exact linked item; estimate pricing stays authoritative. */
export function enrichPrimaryEstimateBudgetCodes(lines: RecordValue[], catalogItems: RecordValue[]): RecordValue[] {
  const byId = new Map<string, RecordValue>();
  for (const item of catalogItems) {
    const id = text(item.id);
    if (!id || byId.has(id)) throw new PrimaryEstimateError('Procore returned conflicting Cost Catalog records. Refresh and try again.');
    byId.set(id, item);
  }
  return lines.map(line => {
    if (primaryEstimateCostAssignment(line).code) return line;
    const item = estimateRecord(line.cost_item);
    const catalog = byId.get(text(item.id));
    if (!catalog) return line;
    // Items can move to another catalog after the estimate was saved. The item ID
    // remains authoritative; the estimate's copied catalog_id can be historical.
    return { ...line, cost_item: { ...item, cost_code: catalog.cost_code, cost_type_code: catalog.cost_type_code } };
  });
}

/** Match the workbook's exclusions and zero-priced hourly labor, using estimate cost (not sales). */
export function parsePrimaryCommitmentEstimate(lines: RecordValue[], groupRecords: RecordValue[]): CommitmentMakerParseResult {
  if (!lines.length) throw new PrimaryEstimateError('The primary estimate has no line items.');
  if (lines.length > 5_000 || groupRecords.length > 100) throw new PrimaryEstimateError('The primary estimate exceeds the import limit of 100 groups or 5,000 lines.');
  const groupById = new Map(groupRecords.map(group => [text(group.id), group]));
  const groups = new Map<string, CommitmentMakerGroup>();
  let skippedRows = 0;
  for (const line of [...lines].sort((a, b) => text(a.id).localeCompare(text(b.id), undefined, { numeric: true }))) {
    const item = estimateRecord(line.cost_item);
    const description = text(line.name || line.description || item.name);
    const assignment = primaryEstimateCostAssignment(line);
    const originalCode = assignment.code;
    const baseCode = originalCode.substring(0, 12).trim();
    const rawUnit = text(item.unit || line.uom || line.unit).toLowerCase().replace(/[_\s]+/g, '');
    const hourly = ['hr', 'hrs', 'hour', 'hours'].includes(rawUnit);
    const quantity = number(line.quantity ?? line.count);
    const amount = number(line.item_cost);
    const unitCost = hourly ? 0 : number(item.unit_cost) ?? (amount !== null && quantity ? amount / quantity : null);
    if (isCommitmentMakerExcludedLine(baseCode, description) || isCommitmentMakerEstimateMatchingLine(baseCode, description)
      || (hourly && `${description} ${originalCode}`.toLowerCase().includes('management'))
      || quantity === 0 || (!hourly && amount === 0 && unitCost === 0)) {
      skippedRows += 1;
      continue;
    }
    if (quantity === null || unitCost === null || !description || !rawUnit) {
      throw new PrimaryEstimateError(`Primary estimate line "${description || text(line.id)}" is missing quantity, cost, or units. Correct it in Procore, then refresh.`);
    }
    const groupId = text(line.group_id || estimateRecord(line.group).id);
    const groupName = text(groupById.get(groupId)?.name || line.group_name || estimateRecord(line.group).name);
    if (!groupName) throw new PrimaryEstimateError(`The group for primary estimate line "${description}" could not be read from Procore.`);
    const key = groupName.toLowerCase().replace(/\s+/g, ' ');
    const group = groups.get(key) || { name: groupName, lineItems: [] };
    const uom = hourly ? 'hours' : ({ cuyd: 'cy', sqft: 'sf', each: 'ea' }[rawUnit] || rawUnit);
    group.lineItems.push({
      costCode: baseCode, costType: normalizeCommitmentMakerCostType(assignment.type),
      description, quantity, uom, unitCost: Math.round(unitCost * 10_000) / 10_000,
      subtotalOverride: hourly ? 0 : amount === null ? null : Math.round(amount * 100) / 100,
    });
    groups.set(key, group);
  }
  if (!groups.size) throw new PrimaryEstimateError('The primary estimate has no importable line items.');
  return { headerRowIndex: -1, groups: [...groups.values()].map(group => ({ ...group,
    lineItems: consolidateCommitmentMakerLineItems(group.lineItems) })), sourceRowCount: lines.length, skippedRows, warnings: [] };
}

export type EstimateCombination = { selectedNames: string[]; name: string };
export function applyPrimaryEstimateCombinations(groups: CommitmentMakerGroup[], value: unknown): CommitmentMakerGroup[] {
  if (value === undefined) return groups;
  if (!Array.isArray(value) || value.length > 100) throw new PrimaryEstimateError('Invalid estimate grouping. Preview the primary estimate again.');
  return value.reduce((current, entry) => {
    const command = estimateRecord(entry);
    if (!Array.isArray(command.selectedNames) || !command.selectedNames.every(name => typeof name === 'string')
      || typeof command.name !== 'string') throw new PrimaryEstimateError('Invalid estimate combination.');
    return combineCommitmentMakerGroups(current, command.selectedNames, command.name);
  }, groups);
}
