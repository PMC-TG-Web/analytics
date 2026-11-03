import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { parseLegacyEstimateLedger } from '@/lib/kpiLegacyEstimateLedger';
import { KPI_OLD_COMPANY } from '@/lib/kpiWinRate';

export async function loadKpiLegacyEstimateLedger() {
  // This file is generated deliberately by the preparation script for the
  // development-only KPI preview. Production never reads local evidence files.
  if (process.env.NODE_ENV === 'development') {
    try {
      const bytes = await fs.readFile(path.join(process.cwd(), '.tmp/kpi-legacy-ledger-preview.json'), 'utf8');
      return { source: 'local-preview' as const, ledger: parseLegacyEstimateLedger(JSON.parse(bytes)) };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  // Prisma generation and the additive migration precede database publication.
  // Until then an absent table means no ledger has been imported, not zero hours.
  let rows;
  try {
    rows = await prisma.kpiLegacyEstimateSnapshot.findMany({ where: { companyId: KPI_OLD_COMPANY }, orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }] });
  } catch (error) { if ((error as { code?: string }).code === 'P2021') return null; throw error; }
  if (!rows.length) return null;
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!latest.has(row.bidBoardId)) latest.set(row.bidBoardId, row);
  const ledger = parseLegacyEstimateLedger({ version: 1, companyId: KPI_OLD_COMPANY, preparedAt: rows[0].capturedAt.toISOString(), skippedMigrated: 0,
    records: [...latest.values()].map(row => ({ hash: row.snapshotHash, snapshot: row.snapshot })) });
  return { source: 'database' as const, ledger };
}
