const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function findDuplicates() {
  const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
  const scopeMap = {};
  const duplicates = {};

  scopesSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const key = `${data.jobKey}|${data.title}`;
    
    if (!scopeMap[key]) {
      scopeMap[key] = [];
    }
    scopeMap[key].push(doc.id);
  });

  // Find duplicates
  Object.entries(scopeMap).forEach(([key, ids]) => {
    if (ids.length > 1) {
      duplicates[key] = ids;
    }
  });

  const duplicateCount = Object.keys(duplicates).length;
  const totalDuplicateIds = Object.values(duplicates).reduce((sum, arr) => sum + arr.length - 1, 0);

  console.log(`Total scopes: ${scopesSnapshot.docs.length}`);
  console.log(`Duplicate scope recipes: ${duplicateCount}`);
  console.log(`Total duplicate document IDs: ${totalDuplicateIds}`);
  
  if (duplicateCount > 0) {
    console.log('\nFirst 5 duplicates:');
    let count = 0;
    for (const [key, ids] of Object.entries(duplicates)) {
      if (count >= 5) break;
      console.log(`\n${key}: ${ids.length} copies`);
      count++;
    }
  }

  process.exit(0);
}

findDuplicates().catch(e => {
  console.error(e);
  process.exit(1);
});
