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

async function checkACTSProject() {
  try {
    const projects = await prisma.project.findMany({
      where: {
        projectName: 'ACTS Lower Gwynedd - Oakbridge Terrace'
      }
    });

    console.log(`=== ACTS Lower Gwynedd - Oakbridge Terrace ===`);
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

    // Apply deduplication logic step by step
    console.log('=== DEDUPLICATION LOGIC ===');
    
    // Step 1: Check for Accepted/In Progress
    const acceptedOrInProgress = projects.filter(p => p.status === 'Accepted' || p.status === 'In Progress');
    console.log(`\n1. Filter by status "Accepted" or "In Progress": ${acceptedOrInProgress.length} found`);
    
    if (acceptedOrInProgress.length === 0) {
      console.log('   → No Accepted/In Progress found, using all projects');
    }

    // Step 2: Apply sorting logic
    const candidates = acceptedOrInProgress.length > 0 ? acceptedOrInProgress : projects;
    
    console.log(`\n2. Sorting candidates (${candidates.length}):`);
    
    candidates.forEach(c => {
      console.log(`   - ${c.customer}: dateUpdated=${c.dateUpdated}, dateCreated=${c.dateCreated}`);
    });

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
        console.log(`   Comparing dateCreated: ${b.customer} (${dateCreatedB}) vs ${a.customer} (${dateCreatedA})`);
        return dateCreatedB.getTime() - dateCreatedA.getTime();
      }

      // Third priority: customer alphabetically
      const customerA = a.customer || '';
      const customerB = b.customer || '';
      const cmp = customerA.localeCompare(customerB);
      console.log(`   Comparing alphabetically: ${customerA} vs ${customerB} = ${cmp}`);
      return cmp;
    });

    console.log(`\n3. After sorting:`);
    candidates.forEach((c, idx) => {
      console.log(`   ${idx + 1}. ${c.customer}`);
    });

    console.log(`\n=== CHOSEN PROJECT ===`);
    const chosen = candidates[0];
    console.log(`Customer: ${chosen.customer}`);
    console.log(`Status: ${chosen.status}`);
    console.log(`Hours: ${chosen.hours}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkACTSProject();
