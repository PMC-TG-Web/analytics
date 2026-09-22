import { prisma } from './prisma';
import { validateFoodEntry, type FoodEntryInput } from './qboFoodTotal';

export async function saveQboFoodTotal(raw: FoodEntryInput, actor: string) {
  const input = validateFoodEntry(raw);
  if (!actor || actor.length > 254) throw new Error('A signed-in operator is required.');
  const { companyId, projectId, month, amount, spentOn, note, entryId } = input;
  const key = { companyId, projectId, month };
  if (!await prisma.pmcProject.findUnique({ where: { companyId_procoreProjectId: { companyId, procoreProjectId: projectId } }, select: { procoreProjectId: true } })) throw new Error('Project not found in this company.');
  async function existingResult() {
    const entry = await prisma.qboBillFoodEntry.findUnique({ where: { id: entryId } });
    if (!entry) return null;
    if (entry.companyId !== companyId || entry.projectId !== projectId || entry.month !== month || entry.spentOn !== spentOn || entry.note !== note || entry.amount.toFixed(2) !== amount || entry.createdBy !== actor) throw new Error('This expense request was already used for different details. Reopen the Food ledger.');
    return { saved: true, alreadySaved: true, entryId };
  }
  const existing = await existingResult();
  if (existing) return existing;
  try {
    return await prisma.$transaction(async tx => {
      await tx.qboBillFoodEntry.create({ data: { id: entryId, ...key, spentOn, note, amount, createdBy: actor } });
      // Atomic increment preserves simultaneous additions from other machines.
      const total = await tx.qboBillFoodTotal.upsert({ where: { companyId_projectId_month: key }, create: { ...key, amount, updatedBy: actor }, update: { amount: { increment: amount }, revision: { increment: 1 }, updatedBy: actor } });
      if (total.amount.gt('999999999.99')) throw new Error('The monthly Food total exceeds the supported amount.');
      await tx.qboBillFoodTotalRevision.create({ data: { ...key, amount: total.amount, updatedBy: actor, revision: total.revision } });
      return { saved: true, alreadySaved: false, entryId };
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      const saved = await existingResult();
      if (saved) return saved;
      throw new Error('Another Food entry is being saved. Retry this same expense.');
    }
    throw e;
  }
}
