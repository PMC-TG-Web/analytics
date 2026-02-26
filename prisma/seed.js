import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

async function main() {
  try {
    // Read the existing KPI JSON data
    const kpiJsonPath = join(__dirname, '../public/kpi-data.json');
    const kpiData = JSON.parse(readFileSync(kpiJsonPath, 'utf-8'));

    console.log(`Found ${kpiData.length} KPI entries to migrate...`);

    // Migrate each entry to the database
    for (const entry of kpiData) {
      const entryKey = `${entry.year}-${String(entry.month).padStart(2, '0')}`;
      
      const migrated = await prisma.kPIEntry.upsert({
        where: { entryKey },
        update: {
          bidSubmittedSales: entry.bidSubmittedSales || null,
          scheduledSales: entry.scheduledSales || null,
          subs: entry.subs || null,
          estimates: entry.estimates || null,
          bidSubmittedHours: entry.bidSubmittedHours || null,
          scheduledHours: entry.scheduledHours || null,
          grossProfit: entry.grossProfit || null,
          cost: entry.cost || null,
          leadtimes: entry.leadtimes || null,
          updatedAt: new Date(),
        },
        create: {
          entryKey,
          year: entry.year,
          month: entry.month,
          monthName: entry.monthName,
          bidSubmittedSales: entry.bidSubmittedSales || null,
          scheduledSales: entry.scheduledSales || null,
          subs: entry.subs || null,
          estimates: entry.estimates || null,
          bidSubmittedHours: entry.bidSubmittedHours || null,
          scheduledHours: entry.scheduledHours || null,
          grossProfit: entry.grossProfit || null,
          cost: entry.cost || null,
          leadtimes: entry.leadtimes || null,
        },
      });

      console.log(`✓ Migrated ${entryKey}: ${JSON.stringify(migrated, null, 2)}`);
    }

    console.log('✓ Migration completed successfully!');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
