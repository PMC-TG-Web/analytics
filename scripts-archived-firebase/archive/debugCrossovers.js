const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const config = require(path.resolve(__dirname, '../src/firebaseConfig.json'));
initializeApp(config);
const db = getFirestore();

(async () => {
  // Check for first CSV row: Wohlsen Construction Company | Crossroads Beverage
  console.log('Checking for: Wohlsen Construction Company | Crossroads Beverage');
  
  let q = query(
    collection(db, 'projects'),
    where('customer', '==', 'Wohlsen Construction Company'),
    where('projectName', '==', 'Crossroads Beverage')
  );
  let snap = await getDocs(q);
  console.log(`Match with exact customer+projectName: ${snap.size} found`);
  if (snap.size > 0) {
    snap.docs.forEach(d => console.log(`  jobKey: ${d.data().jobKey}`));
  }
  
  // Try just projectName
  console.log('\nTrying projectName only: Crossroads Beverage');
  q = query(collection(db, 'projects'), where('projectName', '==', 'Crossroads Beverage'));
  snap = await getDocs(q);
  console.log(`Match with projectName: ${snap.size} found`);
  snap.docs.forEach(d => console.log(`  customer: ${d.data().customer}, jobKey: ${d.data().jobKey}`));
  
  // Fetch a sample row with all its data
  if (snap.size > 0) {
    console.log('\nFirst match full data:');
    console.log(JSON.stringify(snap.docs[0].data(), null, 2).substring(0, 300));
  }
})();
