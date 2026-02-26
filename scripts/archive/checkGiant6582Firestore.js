const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const config = require(path.resolve(__dirname, '../src/firebaseConfig.json'));
initializeApp(config);
const db = getFirestore();

(async () => {
  // Find scopes for Giant #6582
  // First figure out what jobKey it would have
  const customerName = 'Ames Construction, Inc.'; // or similar
  const projectNumber = 'N/A';
  const projectName = 'Giant #6582';
  
  // Try different variants of the jobKey
  const jobKeyVariants = [
    `${customerName}~${projectNumber}~${projectName}`,
    `Ames Construction, Inc.~N/A~Giant #6582`,
    `Ames Construction, Inc.~${projectNumber}~Giant #6582`,
  ];
  
  console.log('Checking projectScopes for Giant #6582...\n');
  
  let found = false;
  for (const jobKey of jobKeyVariants) {
    const q = query(collection(db, 'projectScopes'), where('jobKey', '==', jobKey));
    const snap = await getDocs(q);
    if (snap.size > 0) {
      found = true;
      console.log(`Found ${snap.size} document(s) with jobKey: ${jobKey}`);
      snap.docs.forEach((doc, i) => {
        const data = doc.data();
        console.log(`\nDocument ${i + 1}:`);
        console.log(`  title: ${data.title}`);
        console.log(`  description: ${data.description?.substring(0, 100)}...`);
      });
    }
  }
  
  if (!found) {
    console.log('No exact matches found. Searching all projectScopes with "Giant" in jobKey...');
    const allSnap = await getDocs(collection(db, 'projectScopes'));
    const giantScopes = allSnap.docs.filter(d => d.data().jobKey?.includes('Giant'));
    console.log(`Found ${giantScopes.length} with "Giant" in jobKey:`);
    giantScopes.forEach((doc, i) => {
      const data = doc.data();
      console.log(`  [${i + 1}] jobKey: ${data.jobKey?.substring(0, 60)}`);
    });
  }
})();
