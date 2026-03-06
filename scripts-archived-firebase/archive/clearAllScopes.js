const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, writeBatch } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function clearAllScopes() {
  console.log('Fetching all scopes...');
  
  const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
  console.log(`Found ${scopesSnapshot.docs.length} scopes to delete`);
  
  let deleted = 0;

  // Delete in batches of 100
  for (let i = 0; i < scopesSnapshot.docs.length; i += 100) {
    const batch = writeBatch(db);
    const batchDocs = scopesSnapshot.docs.slice(i, i + 100);
    
    for (const doc of batchDocs) {
      batch.delete(doc.ref);
    }
    
    try {
      await batch.commit();
      deleted += batchDocs.length;
      console.log(`Deleted ${deleted} scopes...`);
    } catch (error) {
      console.error(`Batch failed:`, error.message);
      break;
    }
  }

  console.log(`\n✅ Done: ${deleted} scopes deleted`);
  process.exit(0);
}

clearAllScopes().catch(e => {
  console.error(e);
  process.exit(1);
});
