const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch, query, where, doc } = require('firebase/firestore');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('src/firebaseConfig.json', 'utf8'));
const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
const db = getFirestore(app);

async function cleanup() {
  console.log('--- Emergency Cleanup ---');
  
  // 1. Delete records added today (duplicates from sync attempt)
  console.log('Deleting records created today...');
  const snap = await getDocs(collection(db, 'projects'));
  let batch = writeBatch(db);
  let count = 0;
  let batchSize = 0;
  
  // We'll look for records created in the last 2 hours
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  console.log(`Deleting records created after: ${twoHoursAgo}`);

  for (const d of snap.docs) {
    const data = d.data();
    
    // Deletion condition 1: Created very recently
    const isNew = data.createdAt && data.createdAt > twoHoursAgo;
    
    // Deletion condition 2: Alexander Drive Addition
    const isAlex = data.projectName && data.projectName.includes('Alexander Drive Addition');

    if (isNew || isAlex) {
      batch.delete(d.ref);
      count++;
      batchSize++;
      if (batchSize >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        batchSize = 0;
      }
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  console.log(`Cleanup complete. Deleted ${count} records.`);
  process.exit(0);
}

cleanup();
