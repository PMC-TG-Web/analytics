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

async function checkCozyCabins() {
  try {
    const projects = await prisma.project.findMany({
      where: {
        projectName: 'Cozy Cabins'
      }
    });

    console.log(`=== Cozy Cabins - From Database ===`);
    console.log(`Found ${projects.length} projects\n`);

    projects.forEach((proj, index) => {
      console.log(`Project ${index + 1}:`);
      console.log(`  Customer: ${proj.customer}`);
      console.log(`  Status: ${proj.status}`);
      console.log(`  Hours: ${proj.hours}`);
      console.log(`  Date Updated: ${proj.dateUpdated}`);
      console.log(`  Date Created: ${proj.dateCreated}`);
      console.log('');
    });

    // Apply deduplication logic
    let candidates = projects.filter(p => p.status === 'Accepted' || p.status === 'In Progress');

    if (candidates.length === 0) {
      candidates = projects;
      console.log('No Accepted/In Progress status found, using all projects.\n');
    } else {
      console.log(`Filtered to ${candidates.length} with Accepted/In Progress status.\n`);
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

    console.log('=== CHOSEN PROJECT ===');
    const chosen = candidates[0];
    console.log(`Customer: ${chosen.customer}`);
    console.log(`Status: ${chosen.status}`);
    console.log(`Hours: ${chosen.hours}`);
    console.log(`Date Updated: ${chosen.dateUpdated}`);
    console.log(`Date Created: ${chosen.dateCreated}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkCozyCabins();
