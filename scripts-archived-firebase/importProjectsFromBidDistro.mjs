import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

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
  const str = (value ?? '').toString().trim();
  return str.length ? str : null;
}

function parseCurrency(value) {
  if (value === undefined || value === null) return 0;
  const cleaned = value.toString().replace(/[$,\s]/g, '');
  if (!cleaned) return 0;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const cleaned = value.toString().replace(/[,\s]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBoolean(value) {
  const str = (value ?? '').toString().trim().toLowerCase();
  if (!str) return null;
  if (['yes', 'true', '1', 'y'].includes(str)) return true;
  if (['no', 'false', '0', 'n'].includes(str)) return false;
  return null;
}

function parseDate(value) {
  const raw = trim(value);
  if (!raw) return null;

  const [month, day, year] = raw.split('/').map((part) => Number.parseInt(part, 10));
  if (!month || !day || !year) return null;

  const dt = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function makeKey(projectNumber, customer) {
  return `${projectNumber ?? ''}||${customer ?? ''}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Missing DATABASE_URL. Add DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL / PRISMA_DATABASE_URL) to .env.local and rerun.'
    );
  }

  const csvPath = path.join(__dirname, '..', 'Bid_Distro-Preconstruction.csv');

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true });

  console.log(`Read ${rows.length} rows from Bid_Distro-Preconstruction.csv`);

  const projectMap = new Map();

  for (const row of rows) {
    const projectNumber = trim(row.projectNumber);
    const customer = trim(row.customer);
    const projectName = trim(row.projectName);

    if (!projectNumber && !customer && !projectName) {
      continue;
    }

    const key = makeKey(projectNumber, customer || projectName);

    const status = trim(row.status);
    const estimator = trim(row.estimator);

    const dateUpdated = parseDate(row.ProjectUpdateDate || row.dateUpdated);
    const dateCreated = parseDate(row.dateCreated);

    const existing = projectMap.get(key) ?? {
      projectNumber,
      customer,
      projectName: projectName || 'Unnamed Project',
      status,
      estimator,
      sales: 0,
      cost: 0,
      hours: 0,
      laborSales: 0,
      laborCost: 0,
      projectArchived: parseBoolean(row.ProjectArchived) ?? false,
      dateCreated,
      dateUpdated,
      customFields: {
        source: 'Bid_Distro-Preconstruction.csv',
      },
    };

    existing.projectNumber = existing.projectNumber || projectNumber;
    existing.customer = existing.customer || customer;
    existing.projectName = existing.projectName || projectName || 'Unnamed Project';
    existing.status = existing.status || status;
    existing.estimator = existing.estimator || estimator;
    existing.projectArchived = (parseBoolean(row.ProjectArchived) ?? existing.projectArchived) || false;

    existing.sales += parseCurrency(row.sales);
    existing.cost += parseCurrency(row.cost);
    existing.hours += parseNumber(row.hours);
    existing.laborSales += parseCurrency(row.LaborSales);
    existing.laborCost += parseCurrency(row.LaborCost);

    if (dateCreated && (!existing.dateCreated || dateCreated < existing.dateCreated)) {
      existing.dateCreated = dateCreated;
    }

    if (dateUpdated && (!existing.dateUpdated || dateUpdated > existing.dateUpdated)) {
      existing.dateUpdated = dateUpdated;
      if (status) {
        existing.status = status;
      }
    }

    projectMap.set(key, existing);
  }

  const projects = Array.from(projectMap.values());
  console.log(`Prepared ${projects.length} deduplicated project records`);

  let created = 0;
  let updated = 0;

  for (const project of projects) {
    const where = {
      projectNumber: project.projectNumber ?? undefined,
      customer: project.customer ?? undefined,
    };

    let existing = null;

    if (where.projectNumber || where.customer) {
      existing = await prisma.project.findFirst({
        where: {
          AND: [
            where.projectNumber ? { projectNumber: where.projectNumber } : {},
            where.customer ? { customer: where.customer } : {},
          ],
        },
        select: { id: true },
      });
    }

    if (existing) {
      await prisma.project.update({
        where: { id: existing.id },
        data: {
          projectName: project.projectName,
          status: project.status,
          sales: project.sales,
          cost: project.cost,
          hours: project.hours,
          laborSales: project.laborSales,
          laborCost: project.laborCost,
          projectArchived: project.projectArchived,
          estimator: project.estimator,
          dateCreated: project.dateCreated,
          dateUpdated: project.dateUpdated,
          customFields: project.customFields,
        },
      });
      updated += 1;
    } else {
      await prisma.project.create({
        data: {
          projectNumber: project.projectNumber,
          customer: project.customer,
          projectName: project.projectName,
          status: project.status,
          sales: project.sales,
          cost: project.cost,
          hours: project.hours,
          laborSales: project.laborSales,
          laborCost: project.laborCost,
          projectArchived: project.projectArchived,
          estimator: project.estimator,
          dateCreated: project.dateCreated,
          dateUpdated: project.dateUpdated,
          customFields: project.customFields,
        },
      });
      created += 1;
    }
  }

  const total = await prisma.project.count();

  console.log('Import complete');
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Total projects in table: ${total}`);
}

main()
  .catch((error) => {
    console.error('Import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
