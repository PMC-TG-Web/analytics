export const UNCLASSIFIED_AR = '__unclassified__';
export const AR_BUCKETS = ['current', 'days1To30', 'days31To60', 'days61To90', 'daysOver90', 'undated'] as const;
export type ArBucket = typeof AR_BUCKETS[number];
export const AR_BUCKET_LABELS: Record<ArBucket, string> = {
  current: 'Current', days1To30: '1-30 days', days31To60: '31-60 days',
  days61To90: '61-90 days', daysOver90: '90+ days', undated: 'No due date',
};
export type ArAmounts = Record<ArBucket, number> & { total: number };
export type ArClass = { id: string; name: string; parentId: string | null; active: boolean };
export type ArInvoice = {
  id: string; customerId: string; customerName: string; number: string;
  invoiceDate: string; dueDate: string | null; balanceCents: number; totalCents: number; classIds: string[];
};
export type OpenArReport = {
  version: 1; companyId: string; realmId: string; environment: 'production' | 'sandbox';
  asOfDate: string; generatedAt: string; currency: string; classes: ArClass[]; invoices: ArInvoice[];
  unappliedPaymentCents: number; unappliedPaymentCount: number;
  remainingCreditCents: number; remainingCreditCount: number;
  qboAging: ArAmounts;
};

export class OpenArDataError extends Error {
  constructor(message: string) { super(message); this.name = 'OpenArDataError'; }
}
export function arRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpenArDataError(`${label} is missing or invalid.`);
  return value as Record<string, unknown>;
}
export function arArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new OpenArDataError(`${label} is missing or invalid.`);
  return value;
}
export function arText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new OpenArDataError(`${label} is missing.`);
  return value.trim();
}
export function arDate(value: unknown, label: string): string {
  const date = arText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new OpenArDataError(`${label} is not a valid date.`);
  }
  return date;
}
export function arCents(value: unknown, label: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value))) {
    throw new OpenArDataError(`${label} is not a valid amount.`);
  }
  const amount = typeof value === 'number' ? value : Number(value.replaceAll(',', ''));
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 0.00001) throw new OpenArDataError(`${label} cannot be represented in cents.`);
  return cents;
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new OpenArDataError(`${label} is invalid.`);
  return value;
}
export function emptyArAmounts(): ArAmounts {
  return { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, daysOver90: 0, undated: 0, total: 0 };
}
export function arBucket(dueDate: string | null, asOfDate: string): ArBucket {
  arDate(asOfDate, 'As-of date');
  if (!dueDate) return 'undated';
  const days = (Date.parse(asOfDate) - Date.parse(arDate(dueDate, 'Due date'))) / 86_400_000;
  return days <= 0 ? 'current' : days <= 30 ? 'days1To30' : days <= 60 ? 'days31To60' : days <= 90 ? 'days61To90' : 'daysOver90';
}
export function arTotals(invoices: ArInvoice[], asOfDate: string): ArAmounts {
  const result = emptyArAmounts();
  for (const invoice of invoices) {
    result[arBucket(invoice.dueDate, asOfDate)] += invoice.balanceCents;
    result.total += invoice.balanceCents;
  }
  return result;
}
function uniqueIds(rows: { id: string }[], label: string) {
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new OpenArDataError(`${label} contains duplicate IDs. Refresh again; partial totals are not saved.`);
}

export function parseOpenArReport(value: unknown): OpenArReport {
  const source = arRecord(value, 'Open A/R snapshot');
  if (source.version !== 1 || !['production', 'sandbox'].includes(String(source.environment))) throw new OpenArDataError('Unsupported Open A/R snapshot.');
  const asOfDate = arDate(source.asOfDate, 'As-of date');
  const generatedAt = arText(source.generatedAt, 'Refresh time');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new OpenArDataError('Refresh time is invalid.');
  const currency = arText(source.currency, 'Report currency');
  if (!/^[A-Z]{3}$/.test(currency)) throw new OpenArDataError('Report currency is invalid.');
  const classes = arArray(source.classes, 'Classes').map(value => {
    const row = arRecord(value, 'Class');
    if (typeof row.active !== 'boolean') throw new OpenArDataError('Class activity is invalid.');
    return { id: arText(row.id, 'Class ID'), name: arText(row.name, 'Class name'), parentId: row.parentId == null ? null : arText(row.parentId, 'Parent class ID'), active: row.active };
  });
  uniqueIds(classes, 'Classes');
  const classMap = new Map(classes.map(row => [row.id, row]));
  for (const row of classes) {
    const visited = new Set([row.id]);
    let parent = row.parentId;
    while (parent) {
      if (visited.has(parent) || !classMap.has(parent)) throw new OpenArDataError('Class hierarchy is incomplete or cyclic.');
      visited.add(parent);
      parent = classMap.get(parent)!.parentId;
    }
  }
  const invoices = arArray(source.invoices, 'Open invoices').map(value => {
    const row = arRecord(value, 'Invoice');
    const classIds = arArray(row.classIds, 'Invoice classes').map(id => arText(id, 'Invoice class ID'));
    if (!classIds.length || classIds.some(id => !classMap.has(id))) throw new OpenArDataError('Invoice class references are incomplete.');
    return {
      id: arText(row.id, 'Invoice ID'), customerId: arText(row.customerId, 'Customer ID'),
      customerName: arText(row.customerName, 'Customer name'), number: arText(row.number, 'Invoice number'),
      invoiceDate: arDate(row.invoiceDate, 'Invoice date'), dueDate: row.dueDate == null ? null : arDate(row.dueDate, 'Due date'),
      balanceCents: integer(row.balanceCents, 'Open balance', 1), totalCents: integer(row.totalCents, 'Invoice total'),
      classIds: [...new Set(classIds)].sort(),
    };
  });
  uniqueIds(invoices, 'Open invoices');
  if (invoices.some(row => row.invoiceDate > asOfDate)) throw new OpenArDataError('Future-dated open invoices require review before this report can be refreshed.');
  const aging = arRecord(source.qboAging, 'QBO aging control');
  const qboAging = emptyArAmounts();
  for (const key of [...AR_BUCKETS, 'total'] as const) qboAging[key] = integer(aging[key], 'QBO aging amount', Number.MIN_SAFE_INTEGER);
  if (AR_BUCKETS.reduce((sum, key) => sum + qboAging[key], 0) !== qboAging.total) throw new OpenArDataError('QBO aging columns do not reconcile to their total.');
  return {
    version: 1, companyId: arText(source.companyId, 'Company ID'), realmId: arText(source.realmId, 'QBO realm ID'),
    environment: source.environment === 'production' ? 'production' : 'sandbox', asOfDate, generatedAt, currency,
    classes, invoices: invoices.sort((a, b) => a.customerName.localeCompare(b.customerName) || (a.dueDate || '').localeCompare(b.dueDate || '') || a.id.localeCompare(b.id)),
    unappliedPaymentCents: integer(source.unappliedPaymentCents, 'Unapplied payments'),
    unappliedPaymentCount: integer(source.unappliedPaymentCount, 'Unapplied payment count'),
    remainingCreditCents: integer(source.remainingCreditCents, 'Remaining credits'),
    remainingCreditCount: integer(source.remainingCreditCount, 'Remaining credit count'), qboAging,
  };
}

export function filterArInvoices(report: OpenArReport, selectedClassIds: string[], mode: 'exclude' | 'include', search = ''): ArInvoice[] {
  const selected = new Set(selectedClassIds);
  const classMap = new Map(report.classes.map(row => [row.id, row]));
  if (selectedClassIds.some(id => !classMap.has(id))) throw new OpenArDataError('A selected class is no longer in this snapshot. Clear the class filter.');
  const matches = (id: string): boolean => {
    for (let current: string | null = id; current; current = classMap.get(current)?.parentId || null) {
      if (selected.has(current)) return true;
    }
    return false;
  };
  const text = search.trim().toLowerCase();
  return report.invoices.filter(row => {
    const match = row.classIds.some(matches);
    return (!selected.size || (mode === 'include' ? match : !match))
      && (!text || `${row.customerName} ${row.number} ${row.id}`.toLowerCase().includes(text));
  });
}
export function arReconciliationDifference(report: OpenArReport): number {
  return arTotals(report.invoices, report.asOfDate).total - report.unappliedPaymentCents - report.remainingCreditCents - report.qboAging.total;
}
export function openArCsv(report: OpenArReport, rows: ArInvoice[]): string {
  const classes = new Map(report.classes.map(row => [row.id, row.name]));
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = typeof value === 'string' && /^\s*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = ['As of', 'Currency', 'Customer / project', 'Invoice', 'QBO invoice ID', 'Invoice date', 'Due date', 'Classes', 'Mixed class', ...AR_BUCKETS.map(key => AR_BUCKET_LABELS[key]), 'Open invoice balance'];
  return [header.map(cell).join(','), ...rows.map(row => {
    const bucket = arBucket(row.dueDate, report.asOfDate);
    return [report.asOfDate, report.currency, row.customerName, row.number, row.id, row.invoiceDate, row.dueDate || '',
      row.classIds.map(id => classes.get(id) || id).join('; '), row.classIds.length > 1 ? 'Yes' : 'No',
      ...AR_BUCKETS.map(key => (key === bucket ? row.balanceCents / 100 : 0)), row.balanceCents / 100].map(cell).join(',');
  })].join('\r\n');
}
