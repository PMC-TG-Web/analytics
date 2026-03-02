import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { deduplicateProjects } from './utils/projectDeduplication.mjs';

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

async function deduplicateAndCalculateHours() {
  try {
    // Get all projects from database
    const projects = await prisma.project.findMany({
      select: {
        id: true,
        projectNumber: true,
        projectName: true,
        customer: true,
        status: true,
        hours: true,
        dateUpdated: true,
        dateCreated: true,
        projectArchived: true,
      }
    });

    console.log(`Total projects from database: ${projects.length}\n`);

    // Use the centralized deduplication logic
    const dedup = deduplicateProjects(projects);
    const deduplicatedProjects = dedup.deduplicatedProjects;
    const duplicatesRemoved = dedup.duplicatesRemoved;

    // Calculate hours by status
    const statusGroups = {};
    let totalHours = 0;
    let archivedCount = 0;
    let archivedHours = 0;
    let noCustomerCount = 0;
    let noCustomerHours = 0;

    deduplicatedProjects.forEach(proj => {
      // Skip archived projects
      if (proj.projectArchived === true) {
        archivedCount++;
        archivedHours += proj.hours || 0;
        return;
      }

      // Skip projects without a customer
      if (!proj.customer) {
        noCustomerCount++;
        noCustomerHours += proj.hours || 0;
        return;
      }

      const status = proj.status || 'Unknown';
      if (!statusGroups[status]) {
        statusGroups[status] = { hours: 0, count: 0 };
      }
      statusGroups[status].hours += proj.hours || 0;
      statusGroups[status].count += 1;
      totalHours += proj.hours || 0;
    });

    console.log('=== DEDUPLICATION SUMMARY ===');
    console.log(`Original Projects: ${projects.length}`);
    console.log(`Deduplicated Projects: ${deduplicatedProjects.length}`);
    console.log(`Duplicates Removed: ${duplicatesRemoved}`);

    console.log('\n=== HOURS BY STATUS (Deduplicated from Database) ===');
    Object.entries(statusGroups)
      .sort((a, b) => b[1].hours - a[1].hours)
      .forEach(([s, d]) => {
        console.log(`  ${s}: ${d.hours.toLocaleString()} hours (${d.count} projects)`);
      });

    console.log(`\nTotal Hours: ${totalHours.toLocaleString()}`);
    console.log(`Active Projects: ${deduplicatedProjects.length - archivedCount - noCustomerCount}`);
    console.log(`Archived: ${archivedCount} (${archivedHours.toLocaleString()} hours)`);
    console.log(`No Customer: ${noCustomerCount} (${noCustomerHours.toLocaleString()} hours)`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

deduplicateAndCalculateHours();
