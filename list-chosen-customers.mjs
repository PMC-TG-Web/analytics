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

async function listChosenCustomers() {
  try {
    const projects = await prisma.project.findMany({
      select: {
        projectName: true,
        customer: true,
        status: true,
        hours: true,
        dateUpdated: true,
        dateCreated: true,
      },
      orderBy: { projectName: 'asc' }
    });

    // Group by projectName
    const projectGroups = {};
    projects.forEach(proj => {
      const name = proj.projectName;
      if (!projectGroups[name]) {
        projectGroups[name] = [];
      }
      projectGroups[name].push(proj);
    });

    // Deduplicate and output
    const output = [];
    output.push('PROJECT NAME,CHOSEN CUSTOMER,STATUS,HOURS,IS_DUPLICATE');

    Object.entries(projectGroups).forEach(([name, projectList]) => {
      if (projectList.length === 1) {
        const p = projectList[0];
        output.push(`"${name}","${p.customer || ''}","${p.status || ''}",${p.hours || 0},false`);
      } else {
        // Apply deduplication logic
        let candidates = projectList.filter(p => p.status === 'Accepted' || p.status === 'In Progress');
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
            return -1;
          } else if (!dateUpdatedA && dateUpdatedB) {
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
        
        const chosen = candidates[0];
        output.push(`"${name}","${chosen.customer || ''}","${chosen.status || ''}",${chosen.hours || 0},true`);
      }
    });

    const csv = output.join('\n');
    fs.writeFileSync('chosen-customers.csv', csv, 'utf-8');
    
    console.log(`✅ Saved chosen customers to chosen-customers.csv`);
    console.log(`Total projects: ${Object.keys(projectGroups).length}`);
    
    // Print first 50
    console.log('\n=== FIRST 50 PROJECTS ===\n');
    output.slice(1, 51).forEach((line, idx) => {
      console.log(`${idx + 1}. ${line}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

listChosenCustomers();
