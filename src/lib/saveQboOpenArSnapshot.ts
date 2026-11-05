import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { OpenArDataError, parseOpenArReport } from './qboOpenAr.ts';

export async function saveQboOpenArSnapshot(database: Pick<PrismaClient, 'qboOpenArSnapshot'>, companyId: string, value: unknown) {
  const report = parseOpenArReport(value);
  if (report.companyId !== companyId) throw new OpenArDataError('The QBO host returned a different company. The previous report was retained.');
  const sourceHash = createHash('sha256').update(JSON.stringify(report)).digest('hex');
  await database.qboOpenArSnapshot.upsert({
    where: { sourceHash }, update: {},
    create: {
      companyId, realmId: report.realmId, environment: report.environment, sourceHash,
      sourceGeneratedAt: new Date(report.generatedAt), asOfDate: new Date(report.asOfDate), payload: report,
    },
  });
  return report;
}
