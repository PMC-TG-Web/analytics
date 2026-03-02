import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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

async function deduplicateAndExportCSV() {
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

    // Group projects by projectName
    const projectGroups = {};

    projects.forEach(proj => {
      const name = proj.projectName;
      if (!name) return;

      if (!projectGroups[name]) {
        projectGroups[name] = [];
      }
      projectGroups[name].push(proj);
    });

    // Deduplicate based on the logic
    const deduplicationDetails = [];

    Object.entries(projectGroups).forEach(([name, projectList]) => {
      if (projectList.length === 1) {
        // No duplicates, just add it
        deduplicationDetails.push({
          projectName: name,
          chosenCustomer: projectList[0].customer,
          status: projectList[0].status,
          hours: projectList[0].hours,
          isDuplicate: false,
          duplicateCount: 0,
          otherCustomers: ''
        });
      } else {
        // Multiple projects with the same name - apply deduplication logic
        let candidates = projectList.filter(p => p.status === 'Accepted' || p.status === 'In Progress');

        // If no Accepted/In Progress, use all
        if (candidates.length === 0) {
          candidates = projectList;
        }

        // Sort by dateUpdated (latest first), fallback to dateCreated, then by customer alphabetically
        candidates.sort((a, b) => {
          // First priority: dateUpdated (latest first)
          const dateUpdatedA = a.dateUpdated ? new Date(a.dateUpdated) : null;
          const dateUpdatedB = b.dateUpdated ? new Date(b.dateUpdated) : null;

          // If both have dateUpdated, compare them
          if (dateUpdatedA && dateUpdatedB) {
            if (dateUpdatedB.getTime() !== dateUpdatedA.getTime()) {
              return dateUpdatedB.getTime() - dateUpdatedA.getTime();
            }
          } else if (dateUpdatedA && !dateUpdatedB) {
            // A has dateUpdated, B doesn't - A wins
            return -1;
          } else if (!dateUpdatedA && dateUpdatedB) {
            // B has dateUpdated, A doesn't - B wins
            return 1;
          }

          // Second priority: dateCreated (latest first)
          const dateCreatedA = a.dateCreated ? new Date(a.dateCreated) : new Date(0);
          const dateCreatedB = b.dateCreated ? new Date(b.dateCreated) : new Date(0);

          if (dateCreatedB.getTime() !== dateCreatedA.getTime()) {
            return dateCreatedB.getTime() - dateCreatedA.getTime();
          }

          // Third priority: customer alphabetically
          const customerA = a.customer || '';
          const customerB = b.customer || '';
          return customerA.localeCompare(customerB);
        });

        // Take the first one after sorting
        const chosen = candidates[0];
        const otherCustomers = projectList
          .filter(p => p.customer !== chosen.customer)
          .map(p => p.customer)
          .join('; ');

        deduplicationDetails.push({
          projectName: name,
          chosenCustomer: chosen.customer,
          status: chosen.status,
          hours: chosen.hours,
          isDuplicate: true,
          duplicateCount: projectList.length - 1,
          otherCustomers: otherCustomers
        });
      }
    });

    // Sort by project name
    deduplicationDetails.sort((a, b) => a.projectName.localeCompare(b.projectName));

    // Write to CSV
    const csvHeader = 'Project Name,Chosen Customer,Status,Hours,Is Duplicate,Other Customers\n';
    const csvRows = deduplicationDetails.map(proj => {
      const otherCustomers = proj.otherCustomers.includes(',') 
        ? `"${proj.otherCustomers}"` 
        : proj.otherCustomers;
      return `"${proj.projectName}","${proj.chosenCustomer || ''}","${proj.status || ''}",${proj.hours},${proj.isDuplicate},${otherCustomers}`;
    }).join('\n');

    const csvContent = csvHeader + csvRows;
    fs.writeFileSync('deduplicated-projects.csv', csvContent, 'utf-8');

    console.log(`✅ CSV file created: deduplicated-projects.csv`);
    console.log(`Total deduplicated projects: ${deduplicationDetails.length}`);
    console.log(`Duplicates removed: ${deduplicationDetails.filter(p => p.isDuplicate).length}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

deduplicateAndExportCSV();
