import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareMonthlyBill } from './qboBillComparison';
import type { BillMapping, ComparisonDraft } from './qboBillComparison';
import { hasQboBillBridge, requestQboBillBridge } from './qboBillBridge';
import { actionableBillIssues } from './qboBillIssues';

type Mapping = BillMapping;
export async function loadQboBillReview(companyId: string, projectId: string, month: string, draft?: ComparisonDraft, prepare = false) {
  const directory = path.join(process.env.QBO_INTEGRATION_ROOT?.trim() || path.resolve(process.cwd(), '..', 'QBO_1'), '.runtime', 'direct-cost-bills');
  const base = { itemClasses: {} as Record<string, string>, offsetLines: null as { accountName: string; className: string; amount: number }[] | null, connected: false, customer: null as string | null, billNumber: null as string | null, billId: null as string | null, lastPosted: null as string | null, action: 'unavailable', issues: [] as string[], previousGross: null as number | null, products: {} as Record<string, string>, offsetCategories: {} as Record<string, string>, offsets: null as Mapping['offsets'] | null, canPost: false, fingerprint: null as string | null };
  if (hasQboBillBridge()) {
    try {
      const review = await requestQboBillBridge<typeof base>({ operation: prepare ? 'prepare' : 'status', companyId, projectId, month, draft });
      return { ...review, issues: actionableBillIssues(draft?.issues || [], review.issues) };
    }
    catch { return { ...base, issues: ['Shared QBO service unavailable. Status could not be verified; refresh before posting.'] }; }
  }
  try {
    const names = (await readdir(directory)).filter(n => n.endsWith('-mapping.json'));
    const mappings: Mapping[] = await Promise.all(names.map(async n => JSON.parse(await readFile(path.join(directory, n), 'utf8'))));
    const matches = mappings.filter(m => m.companyId === companyId && m.projectId === projectId);
    if (matches.length !== 1) return base;
    const mapping = matches[0];
    if (!['sandbox', 'production'].includes(mapping.environment) || !/^\d+$/.test(mapping.realmId)) return base;
    const identity = createHash('sha256').update(JSON.stringify([mapping.environment, mapping.realmId, companyId, projectId, month])).digest('hex');
    const result = { ...base, connected: true, customer: mapping.customerFullyQualifiedName || mapping.customerName, action: 'create', products: Object.fromEntries(Object.entries(mapping.items || {}).map(([key, item]) => [key, item.itemName])), offsetCategories: Object.fromEntries(Object.entries(mapping.items || {}).filter(([, item]) => item.offsetCategory).map(([key, item]) => [key, item.offsetCategory!])), offsets: mapping.offsets || null };
    if (draft) result.issues = compareMonthlyBill(draft, mapping).issues;
    const numbers = path.join(directory, 'numbers', `${mapping.environment}-${mapping.realmId}`, 'projects', `${companyId}-${projectId}`);
    try {
      for (const name of (await readdir(numbers)).filter(n => /^\d+\.json$/.test(n))) {
        const record = JSON.parse(await readFile(path.join(numbers, name), 'utf8'));
        if (record.identity === identity) result.billNumber = record.docNumber;
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const claim = path.join(directory, 'posted', identity);
    try {
      const files = await readdir(claim);
      if (files.includes('update-pending.json') || !files.includes('receipt.json')) result.action = 'reconcile';
      if (files.includes('receipt.json')) {
        const receipt = JSON.parse(await readFile(path.join(claim, 'receipt.json'), 'utf8'));
        result.billId = receipt.billId; result.billNumber = receipt.docNumber; result.lastPosted = receipt.updatedAt || receipt.postedAt;
        if (result.action !== 'reconcile') result.action = 'update';
        if (draft && result.action !== 'reconcile') {
          try {
          // Compare only the request proven successful by this receipt, never a preview.
          let saved;
          const attempt = JSON.parse(await readFile(path.join(claim, 'attempt.json'), 'utf8'));
          if (attempt.requestId === receipt.requestId && attempt.fingerprint === receipt.fingerprint) saved = attempt.payload;
          else if (/^pc-[a-f0-9]{40}$/.test(receipt.requestId || '')) {
            const revision = JSON.parse(await readFile(path.join(claim, `update-${receipt.requestId}.json`), 'utf8'));
            if (revision.prepared?.fingerprint === receipt.fingerprint) saved = revision.prepared.payload;
          }
          if (!saved) result.action = 'reconcile';
          else {
            const comparison = compareMonthlyBill(draft, mapping, saved);
            result.previousGross = comparison.previousGross;
            result.action = !receipt.reconciliationPending && comparison.unchanged ? 'current' : 'update';
            if (!draft.lines.length) result.issues.push('All cost lines were removed; reconcile the existing bill before clearing it.');
          }
          } catch { result.action = 'reconcile'; }
        }
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return result;
  } catch { return base; }
}
