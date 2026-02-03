const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');
const csv = require('csv-parse/sync');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function trim(val) {
  return (val || '').toString().trim() || null;
}

function parseNumber(val) {
  if (!val || val === '') return null;
  const num = parseFloat(val.toString().replace(/[$,\s]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function parseBoolean(val) {
  if (!val) return null;
  const s = val.toString().trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

async function importFromCsv() {
  const csvPath = path.join(__dirname, '../src/Bid_Distro-Preconstruction (3).csv');
  console.log(`Reading ${csvPath}...`);
  
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records = csv.parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`✓ Parsed ${records.length} CSV records\n`);
  console.log('Starting import to Firestore...\n');

  let imported = 0;
  let failed = 0;

  console.log(`About to start loop with ${records.length} records`);

  for (let i = 0; i < records.length; i++) {
    if (i === 0 || i % 5000 === 0) {
      console.log(`Processing record ${i + 1}...`);
    }
    const record = records[i];
    try {
      const doc = {
        projectNumber: trim(record.projectNumber),
        dateUpdated: trim(record.dateUpdated),
        projectUpdateDate: trim(record.ProjectUpdateDate),
        reasonForLoss: trim(record.ReasonForLoss),
        projectStage: trim(record.ProjectStage),
        costitems: trim(record.Costitems),
        costType: trim(record.CostType),
        quantity: parseNumber(record.Quantity),
        sales: parseNumber(record.sales),
        laborSales: parseNumber(record.LaborSales),
        laborCost: parseNumber(record.LaborCost),
        cost: parseNumber(record.cost),
        hours: parseNumber(record.hours),
        projectArchived: parseBoolean(record.ProjectArchived),
        customer: trim(record.customer),
        projectName: trim(record.projectName),
        status: trim(record.status),
        testProject: parseBoolean(record.TestProject),
        active: parseBoolean(record.Active),
        dateCreated: trim(record.dateCreated),
        estimator: trim(record.estimator),
      };

      await addDoc(collection(db, 'projects'), doc);
      imported++;

      if (imported % 1000 === 0) {
        console.log(`  ${imported}/${records.length} imported, ${failed} failed`);
      }
    } catch (error) {
      if (i < 3) {
        console.error(`Record ${i + 1} error: ${error.message}`);
      }
      failed++;
      if (failed > 10) {
        console.error('Too many failures, stopping');
        break;
      }
    }
  }

  console.log(`\n✅ Import complete!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total processed: ${imported + failed}`);
  
  process.exit(0);
}

importFromCsv().catch(error => {
  console.error('FATAL:', error.message);
  console.error(error.stack);
  process.exit(1);
});
