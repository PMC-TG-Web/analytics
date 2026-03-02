import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

// Convert Excel serial number to JavaScript Date
function excelToDate(excelSerial) {
  if (!excelSerial) return null;
  const serial = parseInt(excelSerial);
  if (isNaN(serial)) return null;
  // Excel epoch is Jan 1, 1900; Unix epoch is Jan 1, 1970
  // Days between them: 25569
  return new Date((serial - 25569) * 86400000);
}

async function main() {
  console.log('Merging Status table data into Project table...\n');

  try {
    // Get all status records
    const statuses = await prisma.status.findMany();
    console.log(`Found ${statuses.length} status records to merge\n`);

    let updated = 0;
    let notFound = 0;

    // For each status record, find matching project and update its status
    for (const statusRecord of statuses) {
      const project = await prisma.project.findFirst({
        where: {
          customer: statusRecord.customer || undefined,
          projectNumber: statusRecord.projectNumber || undefined,
          projectName: statusRecord.projectName || undefined,
        },
      });

      if (project) {
        const dateCreated = excelToDate(statusRecord.dateCreatedRaw);
        await prisma.project.update({
          where: { id: project.id },
          data: {
            status: statusRecord.status,
            dateCreated: dateCreated,
            estimator: statusRecord.estimator,
          },
        });
        updated++;
      } else {
        notFound++;
        console.log(`  No match: ${statusRecord.projectNumber} - ${statusRecord.projectName} (${statusRecord.customer})`);
      }
    }

    console.log(`\n✓ Merge complete:`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Not found: ${notFound}`);

    // Show status distribution after merge
    const counts = await prisma.project.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    console.log(`\nStatus distribution after merge:`);
    counts.forEach(c => {
      console.log(`  ${c.status || 'null'}: ${c._count.id}`);
    });

    // Show year distribution of dates
    const projectsWithDates = await prisma.project.findMany({
      where: {
        dateCreated: { not: null },
      },
      select: { dateCreated: true },
    });

    const yearCounts = {};
    projectsWithDates.forEach(p => {
      if (p.dateCreated) {
        const year = new Date(p.dateCreated).getFullYear();
        yearCounts[year] = (yearCounts[year] || 0) + 1;
      }
    });

    console.log(`\nDate distribution after merge:`);
    Object.entries(yearCounts).sort().forEach(([year, count]) => {
      console.log(`  ${year}: ${count} projects`);
    });

  } catch (error) {
    console.error('Merge failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
