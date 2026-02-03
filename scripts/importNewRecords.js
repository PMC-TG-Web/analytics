const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');
const csv = require('csv-parse/sync');

// Load Firebase config
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function parseAccountingValue(str) {
  if (!str || str === '') return 0;
  str = str.replace(/[$,\s]/g, '');
  if (str.startsWith('(') && str.endsWith(')')) {
    return -parseFloat(str.slice(1, -1)) || 0;
  }
  return parseFloat(str) || 0;
}

function parseDate(str) {
  if (!str || str === '') return null;
  const date = new Date(str);
  return isNaN(date.getTime()) ? null : date;
}

async function importNewRecords() {
  try {
    console.log('Reading CSV file...');
    const csvPath = path.join(__dirname, '../src/app/Bid_Distro-Preconstruction (2).csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');

    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Total CSV records: ${records.length}`);

    // Filter for records with dateCreated >= 2026-01-01
    const newRecords = records.filter(record => {
      const dateCreated = parseDate(record.dateCreated);
      if (!dateCreated) return false;
      return dateCreated >= new Date('2026-01-01');
    });

    console.log(`New records (Jan 2026+): ${newRecords.length}`);

    if (newRecords.length === 0) {
      console.log('No new records to import');
      return;
    }

    // Show sample
    console.log('\nSample of new records:');
    newRecords.slice(0, 5).forEach(r => {
      console.log(`  ${r.projectNumber} - ${r.projectName} - ${r.status} - ${r.dateCreated}`);
    });

    console.log('\nStarting import...');
    let imported = 0;

    for (const record of newRecords) {
      const doc = {
        projectNumber: record.projectNumber || null,
        projectName: record.projectName || null,
        customer: record.customer || null,
        status: record.status || null,
        estimator: record.estimator || null,
        costitems: record.Costitems || null,
        costType: record.CostType || null,
        quantity: parseAccountingValue(record.Quantity),
        sales: parseAccountingValue(record.sales),
        laborSales: parseAccountingValue(record.LaborSales),
        laborCost: parseAccountingValue(record.LaborCost),
        cost: parseAccountingValue(record.cost),
        hours: parseAccountingValue(record.hours),
        dateCreated: record.dateCreated || null,
        dateUpdated: record.dateUpdated || null,
        projectArchived: record.ProjectArchived === 'Yes',
        projectStage: record.ProjectStage || null,
        reasonForLoss: record.ReasonForLoss || null,
        testProject: record.TestProject === 'Yes',
        active: record.Active === 'Yes',
      };

      await addDoc(collection(db, 'projects'), doc);
      imported++;

      if (imported % 50 === 0) {
        console.log(`Imported ${imported}/${newRecords.length}...`);
      }
    }

    console.log(`\n✅ Successfully imported ${imported} new records`);
  } catch (error) {
    console.error('Error importing:', error);
  }
}

importNewRecords().then(() => process.exit());
