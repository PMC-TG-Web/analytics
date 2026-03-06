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
  try {
    const csvPath = path.join(__dirname, '../src/Bid_Distro-Preconstruction (3).csv');
    console.log(`Reading ${csvPath}...`);
    
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`✓ Parsed ${records.length} CSV records\n`);

    if (records.length === 0) {
      console.error('ERROR: CSV is empty');
      process.exit(1);
    }

    console.log('Starting import to Firestore...\n');
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < records.length; i++) {
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

        if ((i + 1) % 1000 === 0) {
          console.log(`  ${i + 1}/${records.length} processed (${imported} imported, ${failed} failed)`);
        }
      } catch (error) {
        console.error(`Record ${i + 1} error: ${error.message}`);
        failed++;
        if (failed >= 5) {
          console.error('Too many errors, stopping import');
          break;
        }
      }
    }

    console.log(`\n✅ Import complete!`);
    console.log(`   Imported: ${imported}`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Total processed: ${imported + failed}`);
    
    process.exit(0);
  } catch (error) {
    console.error('FATAL ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importFromCsv();
