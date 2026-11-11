import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SteelOrder } from './steelNeeds.ts';

export class SteelOrderConflict extends Error {}
export type SteelOrderInput = { projectId: string; itemKey: string; ordered: boolean; revision: number; quantity: number; orderedQuantity?: number };
export function parseSteelOrderInput(value: unknown): SteelOrderInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !/^\d+$/.test(input.projectId) || input.projectId.length > 40
    || typeof input.itemKey !== 'string' || !input.itemKey || input.itemKey.length > 2000
    || typeof input.ordered !== 'boolean' || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  if (input.orderedQuantity !== undefined) {
    const amount = input.orderedQuantity;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12
      || Number(amount.toFixed(4)) !== amount || input.ordered !== (amount > 0)) return null;
    let key;
    try { key = JSON.parse(input.itemKey); } catch { return null; }
    if (!Array.isArray(key) || key.length !== 2 || typeof key[1] !== 'string' || (key[1] === 'EA' && !Number.isInteger(amount))) return null;
  }
  return { projectId: input.projectId, itemKey: input.itemKey, ordered: input.ordered, revision: Number(input.revision), quantity: input.quantity,
    ...(input.orderedQuantity !== undefined ? { orderedQuantity: Number(input.orderedQuantity) } : {}) };
}

export async function saveSteelOrderMark(db: Pick<PrismaClient, '$transaction'>, companyId: string, actor: string, input: SteelOrderInput): Promise<SteelOrder | null> {
  const key = { companyId, projectId: input.projectId, materialId: createHash('sha256').update(input.itemKey).digest('hex') };
  try {
    return await db.$transaction(async tx => {
      const current = await tx.steelOrderMark.findUnique({ where: { companyId_projectId_materialId: key } });
      if ((current?.revision || 0) !== input.revision) throw new SteelOrderConflict('This mark changed on another screen. Refresh saved data and try again.');
      if (current && current.itemKey !== input.itemKey) throw new Error('Material identity mismatch.');
      const serialize = (row: typeof current): SteelOrder | null => row ? { revision: row.revision, orderedAt: row.orderedAt?.toISOString() || null, quantity: row.quantity === null ? null : Number(row.quantity), estimateQuantity: row.estimateQuantity == null ? null : Number(row.estimateQuantity) } : null;
      const amount = input.orderedQuantity ?? (input.ordered ? input.quantity : 0);
      // Old checkbox callers remain idempotent; new callers explicitly replace the cumulative quantity.
      if (input.orderedQuantity === undefined && !!current?.orderedAt === input.ordered) return serialize(current);
      if (input.orderedQuantity !== undefined && Number(current?.quantity || 0) === amount
        && (amount === 0 || Number(current?.estimateQuantity) === input.quantity)) return serialize(current);
      const data = { itemKey: input.itemKey, revision: input.revision + 1, orderedAt: input.ordered ? new Date() : null,
        quantity: amount > 0 ? amount : null, estimateQuantity: amount > 0 ? input.quantity : null, updatedBy: actor };
      if (!current) return serialize(await tx.steelOrderMark.create({ data: { ...key, ...data } }));
      const result = await tx.steelOrderMark.updateMany({ where: { ...key, revision: input.revision }, data });
      if (result.count !== 1) throw new SteelOrderConflict('This mark changed on another screen. Refresh saved data and try again.');
      return serialize(await tx.steelOrderMark.findUniqueOrThrow({ where: { companyId_projectId_materialId: key } }));
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new SteelOrderConflict('This mark changed on another screen. Refresh saved data and try again.');
    throw error;
  }
}
