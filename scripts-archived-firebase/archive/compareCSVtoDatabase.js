const fs = require('fs');
const csv = require('csv-parse/sync');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingConfigKeys.length > 0) {
  const configPath = path.join(__dirname, '../src/firebaseConfig.json');
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  firebaseConfig.apiKey = fileConfig.apiKey;
  firebaseConfig.authDomain = fileConfig.authDomain;
  firebaseConfig.projectId = fileConfig.projectId;
  firebaseConfig.storageBucket = fileConfig.storageBucket;
  firebaseConfig.messagingSenderId = fileConfig.messagingSenderId;
  firebaseConfig.appId = fileConfig.appId;
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function compareCSVtoDatabase() {
  try {
    // Load CSV
    const filePath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (2).csv';
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const csvRecords = csv.parse(fileContent, { columns: true, skip_empty_lines: true });

    console.log(`\n=== CSV ANALYSIS ===`);
    console.log(`Total CSV records: ${csvRecords.length}`);

    // Create a map of CSV records by (projectNumber, customer, costItems)
    const csvMap = new Map();
    let csvTotalSales = 0;
    csvRecords.forEach(record => {
      const projectNumber = (record.projectNumber || '').toString().trim();
      const customer = (record.customer || '').toString().trim();
      const costItems = (record.Costitems || '').toString().trim();
      const sales = parseFloat((record.sales || '0').toString().replace(/[$,]/g, '')) || 0;
      
      csvTotalSales += sales;
      const key = `${projectNumber}||${customer}||${costItems}`.toLowerCase();
      csvMap.set(key, {
        projectNumber,
        customer,
        costItems,
        sales,
      });
    });

    console.log(`Total CSV sales: $${csvTotalSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

    // Load Database
    const snapshot = await getDocs(collection(db, 'projects'));
    const dbRecords = snapshot.docs.map(doc => doc.data());

    console.log(`\n=== DATABASE ANALYSIS ===`);
    console.log(`Total DB records: ${dbRecords.length}`);

    // Create a map of DB records
    const dbMap = new Map();
    let dbTotalSales = 0;
    dbRecords.forEach(record => {
      const projectNumber = (record.projectNumber || '').toString().trim();
      const customer = (record.customer || '').toString().trim();
      const costItems = (record.costitems || '').toString().trim();
      const sales = record.sales || 0;
      
      dbTotalSales += sales;
      const key = `${projectNumber}||${customer}||${costItems}`.toLowerCase();
      dbMap.set(key, {
        projectNumber,
        customer,
        costItems,
        sales,
      });
    });

    console.log(`Total DB sales: $${dbTotalSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

    // Find records in CSV but not in DB
    console.log(`\n=== MISSING FROM DATABASE ===`);
    const missingRecords = [];
    let missingSales = 0;

    csvMap.forEach((csvRecord, key) => {
      if (!dbMap.has(key)) {
        missingRecords.push(csvRecord);
        missingSales += csvRecord.sales;
      }
    });

    if (missingRecords.length === 0) {
      console.log('✅ All CSV records found in database');
    } else {
      console.log(`❌ ${missingRecords.length} CSV records NOT found in database`);
      console.log(`Total missing sales: $${missingSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`\nMissing records (first 20):`);
      missingRecords.slice(0, 20).forEach((record, idx) => {
        console.log(`  ${idx + 1}. ${record.customer} - ${record.costItems} (${record.projectNumber}): $${record.sales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      });
    }

    // Check for discrepancies
    console.log(`\n=== DISCREPANCY ANALYSIS ===`);
    const salesDifference = csvTotalSales - dbTotalSales;
    console.log(`CSV total - DB total: $${salesDifference.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    if (Math.abs(salesDifference) > 0.01) {
      console.log(`⚠️  There is a ${Math.abs(salesDifference) > 1000 ? 'significant' : 'small'} difference!`);
    } else {
      console.log(`✅ Totals match`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

compareCSVtoDatabase();
