import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';
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

function normalize(value) {
  return (value ?? '').toString().trim().toLowerCase();
}

function cleanText(value) {
  const text = (value ?? '').toString().trim();
  return text.length ? text : null;
}

function parseNumber(value) {
  if (value === undefined || value === null) return 0;
  const cleaned = value.toString().replace(/[$,\s]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeKey(customer, projectNumber, projectName) {
  return `${normalize(customer)}|${normalize(projectNumber)}|${normalize(projectName)}`;
}

function choosePrimaryGroup(groupTotals) {
  const entries = Object.entries(groupTotals);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL. Add DATABASE_URL (or POSTGRES_URL / POSTGRES_PRISMA_URL / PRISMA_DATABASE_URL) to .env.local and rerun.');
  }

  const csvPath = path.join(__dirname, '..', 'Bid_Distro-Preconstruction-Enriched.csv');
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Missing enriched CSV at ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
  });

  const mapByTriple = new Map();
  const mapByCustomerName = new Map();

  for (const row of rows) {
    const customer = cleanText(row.customer);
    const projectNumber = cleanText(row.projectNumber);
    const projectName = cleanText(row.projectName);
    const pmcGroup = cleanText(row.PMCGroup);

    if (!customer || !projectName || !pmcGroup) {
      continue;
    }

    const hours = parseNumber(row.hours);
    const weight = hours;

    if (weight <= 0) {
      continue;
    }

    const keyTriple = makeKey(customer, projectNumber, projectName);
    const keyCustomerName = makeKey(customer, '', projectName);

    if (!mapByTriple.has(keyTriple)) {
      mapByTriple.set(keyTriple, {});
    }
    if (!mapByCustomerName.has(keyCustomerName)) {
      mapByCustomerName.set(keyCustomerName, {});
    }

    const tripleGroups = mapByTriple.get(keyTriple);
    tripleGroups[pmcGroup] = (tripleGroups[pmcGroup] || 0) + weight;

    const customerNameGroups = mapByCustomerName.get(keyCustomerName);
    customerNameGroups[pmcGroup] = (customerNameGroups[pmcGroup] || 0) + weight;
  }

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      customFields: true,
    },
  });

  let updated = 0;
  let mappedByTriple = 0;
  let mappedByCustomerName = 0;
  let unmapped = 0;

  for (const project of projects) {
    const keyTriple = makeKey(project.customer, project.projectNumber, project.projectName);
    const keyCustomerName = makeKey(project.customer, '', project.projectName);

    let breakdown = mapByTriple.get(keyTriple);
    let source = 'triple';

    if (!breakdown || Object.keys(breakdown).length === 0) {
      breakdown = mapByCustomerName.get(keyCustomerName);
      source = 'customer+name';
    }

    if (!breakdown || Object.keys(breakdown).length === 0) {
      unmapped += 1;
      continue;
    }

    const pmcGroup = choosePrimaryGroup(breakdown);
    const existingCustomFields =
      project.customFields && typeof project.customFields === 'object' && !Array.isArray(project.customFields)
        ? project.customFields
        : {};

    await prisma.project.update({
      where: { id: project.id },
      data: {
        customFields: {
          ...existingCustomFields,
          pmcGroup,
          pmcBreakdown: breakdown,
          pmcMappingSource: source,
        },
      },
    });

    if (source === 'triple') mappedByTriple += 1;
    if (source === 'customer+name') mappedByCustomerName += 1;
    updated += 1;
  }

  console.log(`Rows read from enriched CSV: ${rows.length}`);
  console.log(`Projects scanned: ${projects.length}`);
  console.log(`Projects updated: ${updated}`);
  console.log(`Mapped by customer+projectNumber+projectName: ${mappedByTriple}`);
  console.log(`Mapped by customer+projectName: ${mappedByCustomerName}`);
  console.log(`Unmapped projects: ${unmapped}`);
}

main()
  .catch((error) => {
    console.error('PMC mapping failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
