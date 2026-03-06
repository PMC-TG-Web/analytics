const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const config = require(path.resolve(__dirname, '../src/firebaseConfig.json'));
initializeApp(config);
const db = getFirestore();

(async () => {
  const jobKey = 'Ames Construction, Inc.~2508 - GI~Giant #6582';
  
  const q = query(collection(db, 'projectScopes'), where('jobKey', '==', jobKey));
  const snap = await getDocs(q);
  
  console.log(`Found ${snap.size} document(s) for: ${jobKey}\n`);
  
  snap.docs.forEach((doc, i) => {
    const data = doc.data();
    console.log(`Document ${i + 1}:`);
    console.log(`  title: ${data.title}`);
    console.log(`  description: ${data.description}`);
    console.log(`  startDate: ${data.startDate}`);
    console.log(`  endDate: ${data.endDate}`);
    console.log(`  manpower: ${data.manpower}`);
  });
})();
