const fs = require('fs');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch, query, where } = require('firebase/firestore');
const path = require('path');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
if (fs.existsSync(configPath)) {
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  Object.assign(firebaseConfig, fileConfig);
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

async function cleanupDuplicates() {
  try {
    console.log('--- Cleaning Up Duplicates Created Today ---');
    // We want records that HAVE a createdAt field (legacy ones don't)
    const snapshot = await getDocs(collection(db, 'projects'));
    console.log(`Scanning ${snapshot.size} records...`);

    let count = 0;
    let batch = writeBatch(db);
    let batchSize = 0;

    for (const d of snapshot.docs) {
      const data = d.data();
      // Only delete if it was created during today's sync attempts
      if (data.createdAt && data.createdAt.startsWith('2026-02-17')) {
        batch.delete(d.ref);
        count++;
        batchSize++;
        
        if (batchSize >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          batchSize = 0;
          console.log(`Deleted ${count}...`);
        }
      }
    }

    if (batchSize > 0) {
      await batch.commit();
    }

    console.log(`Cleanup Complete: Deleted ${count} records.`);
    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err);
    process.exit(1);
  }
}

cleanupDuplicates();
