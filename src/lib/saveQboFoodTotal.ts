import { prisma } from './prisma';
import { foodTotalAmount } from './qboFoodTotal';
import { directCostMonth } from './qboDirectCosts';

export async function saveQboFoodTotal(input: { companyId: string; projectId: string; month: string; amount: string; revision: number }, actor: string) {
  if (![input.companyId, input.projectId].every(id => /^\d+$/.test(id)) || !Number.isInteger(input.revision) || input.revision < 0 || !actor) throw new Error('Invalid Food total request.');
  directCostMonth(input.month);
  const amount = foodTotalAmount(input.amount);
  const { companyId, projectId, month } = input;
  if (!await prisma.pmcProject.findUnique({ where: { companyId_procoreProjectId: { companyId, procoreProjectId: projectId } }, select: { procoreProjectId: true } })) throw new Error('Project not found in this company.');
  try {
    return await prisma.$transaction(async tx => {
      const key = { companyId, projectId, month };
      const data = { amount, updatedBy: actor };
      if (input.revision === 0) await tx.qboBillFoodTotal.create({ data: { ...key, ...data } });
      else {
        const result = await tx.qboBillFoodTotal.updateMany({ where: { ...key, revision: input.revision }, data: { ...data, revision: { increment: 1 } } });
        if (result.count !== 1) throw new Error('The Food total changed on another screen. Refresh the project before saving.');
      }
      await tx.qboBillFoodTotalRevision.create({ data: { ...key, ...data, revision: input.revision + 1 } });
      return { saved: true, amount, revision: input.revision + 1 };
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new Error('The Food total changed on another screen. Refresh the project before saving.');
    throw e;
  }
}
