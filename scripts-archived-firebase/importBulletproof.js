const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');
const csv = require('csv-parse/sync');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper functions
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
  return s === 'yes' || s === 'true' || s === '1' || s === 'true';
}

async function importFromCsv() {
  try {
    // Read CSV
    const csvPath = path.join(__dirname, '../src/Bid_Distro-Preconstruction (3).csv');
    console.log(`Reading ${csvPath}...`);
    
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`✓ Parsed ${records.length} CSV records\n`);

    // Validate headers
    if (records.length === 0) {
      console.error('ERROR: CSV is empty');
      process.exit(1);
    }

    const firstRecord = records[0];
    const requiredHeaders = ['projectNumber', 'projectName', 'status', 'sales'];
    const missingHeaders = requiredHeaders.filter(h => !(h in firstRecord));
    
    if (missingHeaders.length > 0) {
      console.error(`ERROR: Missing required headers: ${missingHeaders.join(', ')}`);
      console.error('Available headers:', Object.keys(firstRecord));
      process.exit(1);
    }

    console.log('✓ Headers validated');
    console.log('Available headers:', Object.keys(firstRecord).join(', '));
    console.log('');

    // Show sample
    console.log('Sample record mapping:');
    const sample = records[0];
    const sampleDoc = {
      projectNumber: trim(sample.projectNumber),
      projectName: trim(sample.projectName),
      customer: trim(sample.customer),
      status: trim(sample.status),
      sales: parseNumber(sample.sales),
      cost: parseNumber(sample.cost),
      hours: parseNumber(sample.hours),
      dateCreated: trim(sample.dateCreated),
      estimator: trim(sample.estimator),
    };
    console.log(JSON.stringify(sampleDoc, null, 2));
    console.log('\n');

    // Count by status
    const statusCounts = {};
    records.forEach(r => {
      const status = trim(r.status) || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    console.log('Records by status:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    console.log('');

    // Import
    console.log('Starting import to Firestore...\n');
    let imported = 0;
    let skipped = 0;

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

        // Import all records, allowing null values
        await addDoc(collection(db, 'projects'), doc);
        imported++;

        if (imported % 1000 === 0) {
          console.log(`  ${imported}/${records.length} imported, ${skipped} skipped`);
        }
      } catch (error) {
        if (i < 5 || i % 5000 === 0) {
          console.error(`Record ${i + 1} error: ${error.message}`);
        }
        skipped++;
      }
    }

    console.log(`\n✅ Import complete!`);
    console.log(`   Imported: ${imported}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${imported + skipped}`);
    
    process.exit(0);
  } catch (error) {
    console.error('FATAL ERROR:', error.message);
    process.exit(1);
  }
}

importFromCsv();
