import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env.local') });

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';
}

const prisma = new PrismaClient();

function parseDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function parseBoolean(val) {
  if (!val) return false;
  return val.toString().toLowerCase().trim() === 'yes';
}

function parseFloat_(val) {
  if (!val) return null;
  const num = parseFloat(
    val
      .toString()
      .replace(/\$/g, '')
      .replace(/,/g, '')
      .trim()
  );
  return isNaN(num) ? null : num;
}

async function importProjects() {
  try {
    console.log('Reading CSV file...');
    const csvContent = fs.readFileSync('ProjectFilePrisma.csv', 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
    });

    console.log(`Parsed ${records.length} records from CSV`);

    // Delete all existing projects
    console.log('\nDeleting existing projects...');
    const deleted = await prisma.project.deleteMany({});
    console.log(`Deleted ${deleted.count} projects`);

    // Group by projectName and customer to consolidate duplicate entries
    const projectMap = new Map();

    records.forEach((record) => {
      const projectName = record.projectName?.trim();
      const customer = record.customer?.trim();
      const key = `${projectName}|${customer}`;

      if (!projectMap.has(key)) {
        projectMap.set(key, record);
      }
    });

    console.log(
      `\nConsolidated to ${projectMap.size} unique project-customer combinations`
    );

    // Insert projects
    let successCount = 0;
    let errorCount = 0;

    for (const record of projectMap.values()) {
      try {
        const projectNumber = record.projectNumber?.trim() || null;
        const projectName = record.projectName?.trim();
        const customer = record.customer?.trim() || null;
        const status = record.status?.trim() || null;
        const estimator = record.estimator?.trim() || null;

        if (!projectName) {
          console.log('Skipping record with no projectName');
          continue;
        }

        const dateUpdated = parseDate(record.dateUpdated);
        const dateCreated = parseDate(record.dateCreated);
        const sales = parseFloat_(record.sales);
        const laborSales = parseFloat_(record.LaborSales);
        const laborCost = parseFloat_(record.LaborCost);
        const cost = parseFloat_(record.cost);
        const hours = parseFloat_(record.hours);
        const projectArchived = parseBoolean(record.ProjectArchived);

        await prisma.project.create({
          data: {
            projectNumber,
            projectName,
            customer,
            status,
            sales,
            cost,
            hours,
            laborSales,
            laborCost,
            dateUpdated,
            dateCreated,
            projectArchived,
            estimator,
          },
        });

        successCount++;
      } catch (error) {
        errorCount++;
        console.error(
          `Error inserting project ${record.projectName} / ${record.customer}:`,
          error.message
        );
      }
    }

    console.log(`\n=== IMPORT COMPLETE ===`);
    console.log(`Successfully inserted: ${successCount}`);
    console.log(`Errors: ${errorCount}`);

    // Verify import
    const totalProjects = await prisma.project.count();
    console.log(`\nTotal projects in database: ${totalProjects}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

importProjects();
