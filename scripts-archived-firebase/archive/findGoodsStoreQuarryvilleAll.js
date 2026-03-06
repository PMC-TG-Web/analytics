const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

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

async function findGoodsStoreQuarryville() {
  try {
    const snapshot = await getDocs(collection(db, 'projects'));
    const allRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Find all records matching "Goods Store Quarryville" (project name contains it)
    const gsqRecords = allRecords.filter(p => 
      (p.projectName || '').toLowerCase().includes('goods store quarryville')
    );

    console.log(`\n========================================`);
    console.log(`Goods Store Quarryville - All Records (including credits)`);
    console.log(`========================================`);
    console.log(`Total line items: ${gsqRecords.length}\n`);

    let positiveSum = 0;
    let negativeSum = 0;
    let netTotal = 0;

    gsqRecords.forEach((p, idx) => {
      const sales = p.sales || 0;
      netTotal += sales;
      if (sales < 0) {
        negativeSum += sales;
      } else {
        positiveSum += sales;
      }
      console.log(`${idx + 1}. [${p.costitems || 'N/A'}] Sales: $${sales.toLocaleString(undefined, { maximumFractionDigits: 2 })} | Status: ${p.status}`);
    });

    console.log(`\n========================================`);
    console.log(`Sum of positive sales: $${positiveSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`Sum of credits: $${negativeSum.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`NET TOTAL: $${netTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`========================================`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

findGoodsStoreQuarryville();
