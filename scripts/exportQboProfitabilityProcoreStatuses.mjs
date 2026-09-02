import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { buildQboProfitabilityProcoreStatusExport } from './lib/qboProfitabilityProcoreStatuses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });

function parseFileArgument() {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--file='));
  return argument ? argument.slice('--file='.length).trim() : '';
}

const outputArgument = parseFileArgument();
if (!outputArgument) {
  throw new Error('A destination is required. Use --file=<path>.');
}

const outputPath = path.resolve(outputArgument);
const companyId = String(process.env.PROCORE_COMPANY_ID || '598134325805519').trim();
const prisma = new PrismaClient();

try {
  const projects = await prisma.pmcProject.findMany({
    where: { companyId },
    select: {
      procoreProjectId: true,
      bidBoardStatus: true,
      status: true,
    },
  });
  const payload = buildQboProfitabilityProcoreStatusExport(projects, { companyId });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(
    `Exported ${payload.exportedProjectCount} canonical Procore project statuses to ${outputPath}.`,
  );
} finally {
  await prisma.$disconnect();
}
