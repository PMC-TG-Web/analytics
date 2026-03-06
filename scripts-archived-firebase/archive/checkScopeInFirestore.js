const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkScope() {
  const jobKey = 'Ames Construction, Inc.~2508 - GI~Giant #6582';
  const scopeTitle = '53,281 Sq Ft. - 4" Interior Slab on Grade';
  
  console.log(`\nSearching for scope in projectScopes collection...`);
  console.log(`JobKey: ${jobKey}`);
  console.log(`Title: ${scopeTitle}\n`);
  
  const q = query(collection(db, 'projectScopes'), where('jobKey', '==', jobKey));
  const scopesSnapshot = await getDocs(q);
  
  console.log(`Found ${scopesSnapshot.size} scopes for this jobKey\n`);
  
  scopesSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.title === scopeTitle) {
      console.log(`✓ Found matching scope:`);
      console.log(`  Title: ${data.title}`);
      console.log(`  Hours: ${data.hours}`);
      console.log(`  Sales: ${data.sales}`);
      console.log(`  Cost: ${data.cost}`);
      console.log(`  Description: ${data.description || 'N/A'}`);
    }
  });
  
  console.log(`\nAll scopes for this project:`);
  scopesSnapshot.forEach((doc, idx) => {
    const data = doc.data();
    console.log(`${idx + 1}. ${data.title}`);
    console.log(`   Hours: ${data.hours}, Sales: ${data.sales}, Cost: ${data.cost}`);
  });
  
  process.exit(0);
}

checkScope().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
