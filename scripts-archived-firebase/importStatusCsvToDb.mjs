import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';
}

const prisma = new PrismaClient();

function trim(value) {
  const text = (value ?? '').toString().trim();
  if (!text || text.toLowerCase() === '(blank)') return null;
  return text;
}

function parseBoolean(value) {
  const normalized = (value ?? '').toString().trim().toLowerCase();
  if (!normalized || normalized === '(blank)') return null;
  if (['yes', 'true', '1', 'y'].includes(normalized)) return true;
  if (['no', 'false', '0', 'n'].includes(normalized)) return false;
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Missing DATABASE_URL. Add DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL / PRISMA_DATABASE_URL) to .env.local and rerun.'
    );
  }

  const csvPath = path.join(__dirname, '..', 'Status.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Status.csv not found at ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, bom: true, trim: false });

  const records = rows.map((row) => ({
    customer: trim(row.customer),
    projectNumber: trim(row.projectNumber),
    projectName: trim(row.projectName),
    status: trim(row.status),
    testProject: parseBoolean(row.TestProject),
    active: parseBoolean(row.Active),
    dateCreatedRaw: trim(row.dateCreated),
    estimator: trim(row.estimator),
    projectStage: trim(row.ProjectStage),
  }));

  await prisma.status.deleteMany({});

  const chunkSize = 500;
  let inserted = 0;

  for (let index = 0; index < records.length; index += chunkSize) {
    const chunk = records.slice(index, index + chunkSize);
    const result = await prisma.status.createMany({ data: chunk });
    inserted += result.count;
  }

  const total = await prisma.status.count();

  console.log(`Read rows: ${rows.length}`);
  console.log(`Inserted rows: ${inserted}`);
  console.log(`Status table total: ${total}`);
}

main()
  .catch((error) => {
    console.error('Status import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
