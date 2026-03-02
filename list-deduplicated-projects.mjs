import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

async function deduplicateAndListProjects() {
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
    const deduplicatedProjects = [];
    const deduplicationDetails = [];

    Object.entries(projectGroups).forEach(([name, projectList]) => {
      if (projectList.length === 1) {
        // No duplicates, just add it
        deduplicatedProjects.push(projectList[0]);
        deduplicationDetails.push({
          projectName: name,
          chosenCustomer: projectList[0].customer,
          status: projectList[0].status,
          hours: projectList[0].hours,
          isDuplicate: false,
          reason: 'No duplicates'
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

          // Second priority: dateCreated (latest first) - as fallback when dateUpdated is missing or tied
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
        deduplicatedProjects.push(chosen);

        // Determine reason for choice
        let reason = 'Customer alphabetically (all tied)';
        if (projectList.some(p => p.status === 'Accepted' || p.status === 'In Progress')) {
          reason = 'Status (Accepted/In Progress preferred)';
        } else if (candidates.some(c => c.dateUpdated)) {
          reason = 'Latest dateUpdated';
        } else {
          reason = 'Latest dateCreated';
        }

        deduplicationDetails.push({
          projectName: name,
          chosenCustomer: chosen.customer,
          status: chosen.status,
          hours: chosen.hours,
          isDuplicate: true,
          reason: reason,
          otherCustomers: projectList.filter(p => p.customer !== chosen.customer).map(p => p.customer)
        });
      }
    });

    // Sort by project name
    deduplicationDetails.sort((a, b) => a.projectName.localeCompare(b.projectName));

    console.log('=== DEDUPLICATED PROJECTS AND CHOSEN CUSTOMERS ===\n');
    console.log(`Total Projects: ${deduplicationDetails.length}\n`);

    deduplicationDetails.forEach((proj, index) => {
      console.log(`${index + 1}. ${proj.projectName}`);
      console.log(`   Chosen Customer: ${proj.chosenCustomer}`);
      console.log(`   Status: ${proj.status}`);
      console.log(`   Hours: ${proj.hours}`);
      if (proj.isDuplicate) {
        console.log(`   [DUPLICATE] - Chose based on: ${proj.reason}`);
        if (proj.otherCustomers && proj.otherCustomers.length > 0) {
          console.log(`   Other customers: ${proj.otherCustomers.join(', ')}`);
        }
      }
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

deduplicateAndListProjects();
