import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { aggregatePMCBreakdowns } from './utils/pmcGrouping.mjs';

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
      bom: true, // Handle UTF-8 BOM
    });

    console.log(`Parsed ${records.length} line items from CSV`);

    // Group by projectName and customer, aggregating hours, sales/cost, AND collecting line items for PMC
    const projectMap = new Map();

    records.forEach((record) => {
      const projectName = record.projectName?.trim();
      const customer = record.customer?.trim();
      const key = `${projectName}|${customer}`;

      const sales = parseFloat_(record.sales) || 0;
      const cost = parseFloat_(record.cost) || 0;
      const hours = parseFloat_(record.hours) || 0;
      const laborSales = parseFloat_(record.LaborSales) || 0;
      const laborCost = parseFloat_(record.LaborCost) || 0;

      if (!projectMap.has(key)) {
        projectMap.set(key, {
          projectNumber: record.projectNumber?.trim() || null,
          projectName,
          customer,
          status: record.status?.trim() || null,
          estimator: record.estimator?.trim() || null,
          dateUpdated: parseDate(record.dateUpdated),
          dateCreated: parseDate(record.dateCreated),
          projectArchived: parseBoolean(record.ProjectArchived),
          sales: 0,
          cost: 0,
          hours: 0,
          laborSales: 0,
          laborCost: 0,
          lineItems: [], // Collect line items for PMC calculation
          allLineItems: [], // Collect ALL line items for detail modal display
        });
      }

      // Aggregate values
      const proj = projectMap.get(key);
      proj.sales += sales;
      proj.cost += cost;
      proj.hours += hours;
      proj.laborSales += laborSales;
      proj.laborCost += laborCost;
      
      // Add line item to collection for PMC breakdown calculation (only items with hours)
      if (record.Costitems && hours > 0) {
        proj.lineItems.push({
          Costitems: record.Costitems.trim(), // Trim whitespace to match database mappings
          hours: hours
        });
      }
      
      // Collect ALL line items for detail modal (including parts, equipment, etc.)
      proj.allLineItems.push({
        costitems: record.Costitems?.trim() || '',
        costType: record.CostType?.trim() || 'Unassigned',
        quantity: parseFloat_(record.Quantity) || 0,
        sales: sales,
        cost: cost,
        hours: hours,
        laborSales: laborSales,
        laborCost: laborCost,
        scopeOfWork: record.ScopeOfWork?.trim() || ''
      });

      // Use latest dates
      if (record.dateUpdated && (!proj.dateUpdated || new Date(record.dateUpdated) > proj.dateUpdated)) {
        proj.dateUpdated = parseDate(record.dateUpdated);
      }
      if (record.dateCreated && (!proj.dateCreated || new Date(record.dateCreated) < proj.dateCreated)) {
        proj.dateCreated = parseDate(record.dateCreated);
      }
    });

    console.log(
      `\nAggregated to ${projectMap.size} unique projects`
    );

    // Delete all existing projects
    console.log('\nDeleting existing projects...');
    const deleted = await prisma.project.deleteMany({});
    console.log(`Deleted ${deleted.count} projects`);

    // Insert aggregated projects
    let successCount = 0;
    let errorCount = 0;
    let totalHours = 0;

    for (const proj of projectMap.values()) {
      try {
        if (!proj.projectName) {
          continue;
        }

        // Calculate PMC breakdowns from collected line items
        const pmcData = await aggregatePMCBreakdowns(proj.lineItems);
        
        // Store PMC breakdowns AND all line items in customFields
        const customFields = {
          pmcBreakdown: pmcData.pmcBreakdown,
          pmcGroup: pmcData.pmcGroupBreakdown,
          pmcTotalHours: pmcData.totalHours,
          lineItems: proj.allLineItems // Store all line items for detail modal
        };

        const created = await prisma.project.create({
          data: {
            projectNumber: proj.projectNumber,
            projectName: proj.projectName,
            customer: proj.customer,
            status: proj.status,
            sales: proj.sales > 0 ? proj.sales : null,
            cost: proj.cost > 0 ? proj.cost : null,
            hours: proj.hours > 0 ? proj.hours : null,
            laborSales: proj.laborSales > 0 ? proj.laborSales : null,
            laborCost: proj.laborCost > 0 ? proj.laborCost : null,
            dateUpdated: proj.dateUpdated,
            dateCreated: proj.dateCreated,
            projectArchived: proj.projectArchived,
            estimator: proj.estimator,
            customFields: customFields, // NEW: include PMC breakdowns
          },
        });

        totalHours += proj.hours;
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(
          `Error inserting project ${proj.projectName} / ${proj.customer}:`,
          error.message
        );
      }
    }

    console.log(`\n=== IMPORT COMPLETE ===`);
    console.log(`Successfully inserted: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total hours imported: ${totalHours.toLocaleString()}`);

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
