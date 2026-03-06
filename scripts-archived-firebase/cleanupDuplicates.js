const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function fix() {
  try {
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    // Group by jobKey and count titles
    const jobKeyMap = {};
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const jobKey = data.jobKey;
      const title = data.title;
      
      if (!jobKeyMap[jobKey]) jobKeyMap[jobKey] = {};
      if (!jobKeyMap[jobKey][title]) jobKeyMap[jobKey][title] = [];
      jobKeyMap[jobKey][title].push(docSnap.id);
    });
    
    // Find and delete duplicates
    let deleted = 0;
    const duplicateList = [];
    
    for (const [jobKey, titles] of Object.entries(jobKeyMap)) {
      for (const [title, docIds] of Object.entries(titles)) {
        if (docIds.length > 1) {
          duplicateList.push({ jobKey, title, count: docIds.length });
          
          // Keep first, delete rest
          for (let i = 1; i < docIds.length; i++) {
            await deleteDoc(doc(db, 'projectScopes', docIds[i]));
            deleted++;
          }
        }
      }
    }
    
    console.log(`Found ${duplicateList.length} duplicate scopes, deleted ${deleted} documents:\n`);
    duplicateList.forEach(dup => {
      console.log(`  ${dup.jobKey}`);
      console.log(`    "${dup.title}" (${dup.count} copies)`);
    });
    
    console.log(`\n✅ Cleanup complete`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fix();
