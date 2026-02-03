const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, deleteDoc, getDocs } = require('firebase/firestore');
const csv = require('csv-parse/sync');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function parseMoneyValue(str) {
  if (!str || str === '') return null;
  const num = parseFloat(str.toString().replace(/[$,\s]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function parseBoolean(str) {
  if (!str) return null;
  const s = str.toString().trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

async function importCsv() {
  try {
    console.log('Reading CSV...');
    const csvPath = path.join(__dirname, '../src/Bid_Distro-Preconstruction (3).csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    
    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Parsed ${records.length} records`);

    // Clear collection
    console.log('Clearing existing projects...');
    const snapshot = await getDocs(collection(db, 'projects'));
    for (const doc of snapshot.docs) {
      await deleteDoc(doc.ref);
    }
    console.log('Cleared');

    // Import
    let imported = 0;
    for (const record of records) {
      const doc = {
        projectNumber: (record.projectNumber || '').trim() || null,
        dateUpdated: (record.dateUpdated || '').trim() || null,
        projectUpdateDate: (record.ProjectUpdateDate || '').trim() || null,
        reasonForLoss: (record.ReasonForLoss || '').trim() || null,
        projectStage: (record.ProjectStage || '').trim() || null,
        costitems: (record.Costitems || '').trim() || null,
        costType: (record.CostType || '').trim() || null,
        quantity: parseMoneyValue(record.Quantity),
        sales: parseMoneyValue(record.sales),
        laborSales: parseMoneyValue(record.LaborSales),
        laborCost: parseMoneyValue(record.LaborCost),
        cost: parseMoneyValue(record.cost),
        hours: parseMoneyValue(record.hours),
        projectArchived: parseBoolean(record.ProjectArchived),
        customer: (record.customer || '').trim() || null,
        projectName: (record.projectName || '').trim() || null,
        status: (record.status || '').trim() || null,
        testProject: parseBoolean(record.TestProject),
        active: parseBoolean(record.Active),
        dateCreated: (record.dateCreated || '').trim() || null,
        estimator: (record.estimator || '').trim() || null,
      };

      await addDoc(collection(db, 'projects'), doc);
      imported++;

      if (imported % 500 === 0) {
        console.log(`Imported ${imported}/${records.length}...`);
      }
    }

    console.log(`\n✅ Successfully imported ${imported} records`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

importCsv();
