// scripts/importCsvToFirestore.js
// Usage: node scripts/importCsvToFirestore.js

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function importCsv() {
  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // Read and parse CSV
  const csvPath = path.join(__dirname, '../Bid_Distro_Hours.csv');
  const fileContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // Helper to parse currency/number fields
  function parseNumber(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    return Number(String(val).replace(/[$,\s]/g, '')) || 0;
  }

  const BATCH_SIZE = 400;
  let imported = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      // Parse cost, sales, hours as numbers
      const doc = {
        ...row,
        cost: parseNumber(row.cost),
        sales: parseNumber(row.sales),
        hours: parseNumber(row.hours),
      };
      await addDoc(collection(db, 'projects'), doc);
      imported++;
      if (imported % 100 === 0) {
        console.log(`Imported ${imported} records...`);
      }
    }
  }
  console.log(`Import complete! Total records imported: ${imported}`);
}

importCsv().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
