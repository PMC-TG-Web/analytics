import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { SteelOrder } from './steelNeeds.ts';

export class SteelOrderConflict extends Error {}
export type SteelOrderInput = { projectId: string; itemKey: string; ordered: boolean; revision: number; quantity: number };
export function parseSteelOrderInput(value: unknown): SteelOrderInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !/^\d+$/.test(input.projectId) || input.projectId.length > 40
    || typeof input.itemKey !== 'string' || !input.itemKey || input.itemKey.length > 2000
    || typeof input.ordered !== 'boolean' || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  return { projectId: input.projectId, itemKey: input.itemKey, ordered: input.ordered, revision: Number(input.revision), quantity: input.quantity };
}

export async function saveSteelOrderMark(db: Pick<PrismaClient, '$transaction'>, companyId: string, actor: string, input: SteelOrderInput): Promise<SteelOrder | null> {
  const key = { companyId, projectId: input.projectId, materialId: createHash('sha256').update(input.itemKey).digest('hex') };
  try {
    return await db.$transaction(async tx => {
      const current = await tx.steelOrderMark.findUnique({ where: { companyId_projectId_materialId: key } });
      if ((current?.revision || 0) !== input.revision) throw new SteelOrderConflict('This mark changed on another screen. Refresh saved data and try again.');
      if (current && current.itemKey !== input.itemKey) throw new Error('Material identity mismatch.');
      const serialize = (row: typeof current): SteelOrder | null => row ? { revision: row.revision, orderedAt: row.orderedAt?.toISOString() || null, quantity: row.quantity === null ? null : Number(row.quantity) } : null;
      if (!!current?.orderedAt === input.ordered) return serialize(current);
      const data = { itemKey: input.itemKey, revision: input.revision + 1, orderedAt: input.ordered ? new Date() : null,
        quantity: input.ordered ? input.quantity : null, updatedBy: actor };
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
