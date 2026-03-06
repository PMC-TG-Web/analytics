const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, deleteDoc, getDocs } = require('firebase/firestore');
const csv = require('csv-parse/sync');

// Firebase config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Fallback to firebaseConfig.json if env vars missing
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

async function importPMCGrouping() {
  try {
    console.log('Reading PMCGrouping CSV file...');
    const csvPath = path.join(__dirname, '../PMCGrouping.csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');

    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Parsed ${records.length} grouping records from CSV`);

    // Clear existing lookup table
    console.log('Clearing existing PMC grouping lookup table...');
    const snapshot = await getDocs(collection(db, 'pmcGrouping'));
    for (const doc of snapshot.docs) {
      await deleteDoc(doc.ref);
    }
    console.log('Cleared existing PMC grouping lookup table');

    // Upload records
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < records.length; i++) {
      try {
        const record = records[i];

        const doc = {
          costItem: record.CostItem?.trim() || '',
          costType: record.CostType?.trim() || '',
          pmcGroup: record.PMCGroup?.trim() || '',
        };

        // Skip empty records
        if (!doc.costItem && !doc.costType && !doc.pmcGroup) {
          continue;
        }

        if (i === 0) {
          console.log('Sample record:', doc);
        }

        await addDoc(collection(db, 'pmcGrouping'), doc);
        successCount++;

        if ((successCount + errorCount) % 100 === 0) {
          console.log(`Progress: ${successCount + errorCount} records processed (${successCount} success, ${errorCount} errors)`);
        }
      } catch (error) {
        errorCount++;
        if (errorCount <= 5) {
          console.error(`Error importing record ${i}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Successfully imported ${successCount} PMC grouping records to Firestore`);
    console.log(`⚠️  Errors: ${errorCount}`);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

importPMCGrouping();
