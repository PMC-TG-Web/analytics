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

/** Some assembly children omit a permanent item ID in Procore's estimate response. */
export function primaryEstimateAssemblyCatalogId(line: RecordValue): string {
  const item = estimateRecord(line.cost_item);
  if (text(item.id) && text(item.id) !== '0') return '';
  const id = text(item.catalog_id);
  return /^[1-9]\d*$/.test(id) ? id : '';
}

function assemblyItemIdentity(item: RecordValue): string {
  // Estimate units and prices may be overridden. Match original item metadata,
  // never the editable line name, group name, quantity, units or price.
  if (!text(item.name) || !text(item.description) || !text(item.type)) return '';
  // Procore may reclassify custom/subcontractor components after an estimate
  // was copied. This item category is independent of its budget cost type (LS).
  const type = text(item.type).toUpperCase();
  const identityType = ['CUSTOM', 'SUBCONTRACTOR'].includes(type) ? 'CUSTOM' : type;
  return JSON.stringify([item.name, item.description, identityType, item.manufacturer, item.catalog_number]
    .map(value => text(value).toLowerCase().replace(/\s+/g, ' ')));
}

/** Only copy coding fields; estimate-specific assignments and pricing stay authoritative. */
export function enrichPrimaryEstimateBudgetCodes(lines: RecordValue[], catalogItems: RecordValue[],
  assemblyCatalogs: ReadonlyMap<string, RecordValue[]> = new Map()): RecordValue[] {
  const byId = new Map<string, RecordValue>();
  for (const item of catalogItems) {
    const id = text(item.id);
    if (!id || byId.has(id)) throw new PrimaryEstimateError('Procore returned conflicting Cost Catalog records. Refresh and try again.');
    byId.set(id, item);
  }
  type Candidate = { assemblyId: string; item: RecordValue };
  const assemblyIndexes = new Map<string, Map<string, Candidate[]>>();
  for (const [catalogId, assemblies] of assemblyCatalogs) {
    const index = new Map<string, Candidate[]>();
    for (const assembly of assemblies) {
      const assemblyId = text(assembly.id);
      if (!assemblyId) throw new PrimaryEstimateError('Procore returned an incomplete assembly catalog. Refresh and try again.');
      function visit(value: unknown) {
        if (!Array.isArray(value)) return;
        for (const entry of value) {
          const item = estimateRecord(entry);
          const key = assemblyItemIdentity(item);
          if (key) index.set(key, [...(index.get(key) || []), { assemblyId, item }]);
          visit(item.sub_items);
        }
      }
      visit(assembly.sub_items);
    }
    assemblyIndexes.set(catalogId, index);
  }
  const candidatesByLine = new Map<RecordValue, Candidate[]>();
  const commonAssemblies = new Map<string, Set<string>>();
  const scopeKey = (line: RecordValue, catalogId: string) => {
    const groupId = text(line.group_id || estimateRecord(line.group).id);
    return groupId ? JSON.stringify([catalogId, groupId]) : '';
  };
  for (const line of lines) {
    const catalogId = primaryEstimateAssemblyCatalogId(line);
    const candidates = assemblyIndexes.get(catalogId)?.get(assemblyItemIdentity(estimateRecord(line.cost_item))) || [];
    candidatesByLine.set(line, candidates);
    const scope = scopeKey(line, catalogId);
    if (!scope || !candidates.length) continue;
    const parents = new Set(candidates.map(candidate => candidate.assemblyId));
    const common = commonAssemblies.get(scope);
    // A group can identify an assembly only when every matching original item
    // belongs to it. Conflicting groups never choose a best-scoring substitute.
    commonAssemblies.set(scope, common ? new Set([...common].filter(id => parents.has(id))) : parents);
  }
  const assignmentKey = ({ item }: Candidate) => {
    const assignment = primaryEstimateCostAssignment({ cost_item: item });
    return assignment.code ? `${assignment.code}|${normalizeCommitmentMakerCostType(assignment.type)}` : '';
  };
  return lines.map(line => {
    if (primaryEstimateCostAssignment(line).code) return line;
    const item = estimateRecord(line.cost_item);
    const catalogId = primaryEstimateAssemblyCatalogId(line);
    let catalog = /^[1-9]\d*$/.test(text(item.id)) ? byId.get(text(item.id)) : undefined;
    if (catalogId) {
      let candidates = candidatesByLine.get(line) || [];
      if (new Set(candidates.map(assignmentKey)).size > 1) {
        const common = commonAssemblies.get(scopeKey(line, catalogId));
        candidates = common?.size ? candidates.filter(candidate => common.has(candidate.assemblyId)) : [];
      }
      const assignments = new Set(candidates.map(assignmentKey));
      if (assignments.size === 1 && !assignments.has('')) catalog = candidates[0].item;
    }
    if (!catalog) return line;
    // Leave the original item identity and all estimate overrides intact.
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
