import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { steelOrderLogEntry, type SteelOrder, type SteelOrderLogEntry } from './steelNeeds.ts';

export class SteelOrderConflict extends Error {}
/**
 * quantity is the displayed estimate. Exactly one change applies: addQuantity logs an order,
 * undoEntryId undoes a log line, otherwise ordered/orderedQuantity set the running total.
 */
export type SteelOrderInput = { projectId: string; itemKey: string; ordered: boolean; revision: number; quantity: number; orderedQuantity?: number; addQuantity?: number; undoEntryId?: string };
function validAmount(amount: unknown, itemKey: string): amount is number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12 || Number(amount.toFixed(4)) !== amount) return false;
  let key;
  try { key = JSON.parse(itemKey); } catch { return false; }
  return Array.isArray(key) && key.length === 2 && typeof key[1] === 'string' && !(key[1] === 'EA' && !Number.isInteger(amount));
}
export function parseSteelOrderInput(value: unknown): SteelOrderInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !/^\d+$/.test(input.projectId) || input.projectId.length > 40
    || typeof input.itemKey !== 'string' || !input.itemKey || input.itemKey.length > 2000
    || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  const base = { projectId: input.projectId, itemKey: input.itemKey, revision: Number(input.revision), quantity: input.quantity };
  if ([input.orderedQuantity, input.addQuantity, input.undoEntryId].filter(mode => mode !== undefined).length > 1) return null;
  if (input.addQuantity !== undefined) {
    return validAmount(input.addQuantity, input.itemKey) && input.addQuantity > 0 ? { ...base, ordered: true, addQuantity: input.addQuantity } : null;
  }
  if (input.undoEntryId !== undefined) {
    return typeof input.undoEntryId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.undoEntryId)
      ? { ...base, ordered: false, undoEntryId: input.undoEntryId } : null;
  }
  if (typeof input.ordered !== 'boolean') return null;
  const total = input.orderedQuantity;
  if (total === undefined) return { ...base, ordered: input.ordered };
  return validAmount(total, input.itemKey) && input.ordered === (total > 0) ? { ...base, ordered: input.ordered, orderedQuantity: total } : null;
}

const changedElsewhere = 'This order changed on another screen. Refresh saved data and try again.';
const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Applies one change to a job material's ordered total and records it in the order log, atomically.
 * The mark keeps the running total; its revision guards every kind of change.
 */
export async function saveSteelOrder(db: Pick<PrismaClient, '$transaction'>, companyId: string, actor: string, input: SteelOrderInput): Promise<{ order: SteelOrder | null; log: SteelOrderLogEntry[] }> {
  const key = { companyId, projectId: input.projectId, materialId: createHash('sha256').update(input.itemKey).digest('hex') };
  try {
    return await db.$transaction(async tx => {
      const current = await tx.steelOrderMark.findUnique({ where: { companyId_projectId_materialId: key } });
      if ((current?.revision || 0) !== input.revision) throw new SteelOrderConflict(changedElsewhere);
      if (current && current.itemKey !== input.itemKey) throw new Error('Material identity mismatch.');
      const serialize = (row: typeof current): SteelOrder | null => row ? { revision: row.revision, orderedAt: row.orderedAt?.toISOString() || null, quantity: row.quantity === null ? null : Number(row.quantity), estimateQuantity: row.estimateQuantity == null ? null : Number(row.estimateQuantity) } : null;
      const result = async (row: typeof current) => ({ order: serialize(row),
        log: (await tx.steelOrderEntry.findMany({ where: key, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(steelOrderLogEntry) });
      const now = new Date(), total = Number(current?.quantity || 0);
      const record = (kind: 'order' | 'correction', quantity: number) => tx.steelOrderEntry.create({
        data: { ...key, itemKey: input.itemKey, kind, quantity, estimateQuantity: input.quantity, createdBy: actor, createdAt: now } });
      let amount: number;
      if (input.undoEntryId !== undefined) {
        const target = await tx.steelOrderEntry.findFirst({ where: { ...key, id: input.undoEntryId, voidedAt: null } });
        if (!target) throw new SteelOrderConflict('That order is no longer in the log. Refresh saved data and try again.');
        const undone = await tx.steelOrderEntry.updateMany({ where: { id: target.id, voidedAt: null }, data: { voidedAt: now, voidedBy: actor } });
        if (undone.count !== 1) throw new SteelOrderConflict(changedElsewhere);
        amount = Math.max(0, round(total - Number(target.quantity)));
      } else if (input.addQuantity !== undefined) {
        amount = round(total + input.addQuantity);
        if (amount > 1e12) throw new SteelOrderConflict('The ordered total is too large. Correct the total instead.');
        await record('order', input.addQuantity);
      } else {
        amount = input.orderedQuantity ?? (input.ordered ? input.quantity : 0);
        // Old checkbox callers remain idempotent; explicit totals replace the running total.
        if (input.orderedQuantity === undefined && !!current?.orderedAt === input.ordered) return result(current);
        if (input.orderedQuantity !== undefined && total === amount
          && (amount === 0 || Number(current?.estimateQuantity) === input.quantity)) return result(current);
        if (round(amount - total) !== 0) await record('correction', round(amount - total));
      }
      const data = { itemKey: input.itemKey, revision: input.revision + 1, orderedAt: amount > 0 ? now : null,
        quantity: amount > 0 ? amount : null, estimateQuantity: amount > 0 ? input.quantity : null, updatedBy: actor };
      if (!current) return result(await tx.steelOrderMark.create({ data: { ...key, ...data } }));
      const updated = await tx.steelOrderMark.updateMany({ where: { ...key, revision: input.revision }, data });
      if (updated.count !== 1) throw new SteelOrderConflict(changedElsewhere);
      return result(await tx.steelOrderMark.findUniqueOrThrow({ where: { companyId_projectId_materialId: key } }));
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new SteelOrderConflict(changedElsewhere);
    throw error;
  }
}

/** For callers that need only the running total. */
export async function saveSteelOrderMark(db: Pick<PrismaClient, '$transaction'>, companyId: string, actor: string, input: SteelOrderInput): Promise<SteelOrder | null> {
  return (await saveSteelOrder(db, companyId, actor, input)).order;
}
