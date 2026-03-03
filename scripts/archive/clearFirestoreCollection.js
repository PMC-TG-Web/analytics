// scripts/clearFirestoreCollection.js
// Usage: node scripts/clearFirestoreCollection.js [collectionName]

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function clearCollection(collName) {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const collRef = collection(db, collName);
  const snapshot = await getDocs(collRef);
  let deleted = 0;
  for (const d of snapshot.docs) {
    await deleteDoc(doc(db, collName, d.id));
    deleted++;
    if (deleted % 100 === 0) {
      console.log(`Deleted ${deleted} documents...`);
    }
  }
  console.log(`Cleared collection '${collName}'. Total deleted: ${deleted}`);
}

const collectionName = process.argv[2] || 'schedules';

clearCollection(collectionName).catch(err => {
  console.error('Failed to clear collection:', err);
  process.exit(1);
});
