import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import {
  hashQboProfitabilitySource,
  normalizeQboProfitabilityPayload,
} from './lib/qboProfitabilityPayload.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });

function parseFileArgument() {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--file='));
  return argument ? argument.slice('--file='.length).trim() : '';
}

async function findLatestExport() {
  const reportDirectory = path.resolve(root, '..', 'QBO_1', 'reports');
  const candidates = (await readdir(reportDirectory))
    .filter((name) => /^project-profitability-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.json$/.test(name));
  if (!candidates.length) {
    throw new Error(`No QBO profitability export was found in ${reportDirectory}.`);
  }
  const withStats = await Promise.all(candidates.map(async (name) => ({
    path: path.join(reportDirectory, name),
    modifiedAt: (await stat(path.join(reportDirectory, name))).mtimeMs,
  })));
  withStats.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return withStats[0].path;
}

async function main() {
  const explicitFile = parseFileArgument();
  const filePath = explicitFile ? path.resolve(process.cwd(), explicitFile) : await findLatestExport();
  const fileStats = await stat(filePath);
  if (fileStats.size > 50 * 1024 * 1024) {
    throw new Error('The profitability export exceeds the 50 MB import limit.');
  }
  const raw = await readFile(filePath, 'utf8');
  const sourceHash = hashQboProfitabilitySource(raw);
  const payload = normalizeQboProfitabilityPayload(JSON.parse(raw));
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.qboProfitabilitySnapshot.findUnique({
      where: { sourceHash },
      select: { id: true, importedAt: true },
    });
    if (existing) {
      console.log(`This read-only snapshot was already imported at ${existing.importedAt.toISOString()}.`);
      return;
    }

    const snapshot = await prisma.qboProfitabilitySnapshot.create({
      data: {
        sourceHash,
        sourceGeneratedAt: payload.generatedAt,
        startDate: payload.startDate,
        endDate: payload.endDate,
        accountingMethod: payload.accountingMethod,
        readOnly: true,
        summary: payload.summary,
        sourceCounts: payload.sourceCounts,
        rows: { create: payload.rows },
      },
      select: { id: true, importedAt: true, _count: { select: { rows: true } } },
    });

    console.log(`Imported ${snapshot._count.rows} normalized profitability rows.`);
    console.log(`Snapshot ID: ${snapshot.id}`);
    console.log(`Imported at: ${snapshot.importedAt.toISOString()}`);
    console.log('QuickBooks and Procore business records were not changed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`QBO profitability import failed: ${error.message}`);
  process.exitCode = 1;
});
