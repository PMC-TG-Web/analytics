const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const config = require(path.resolve(__dirname, '../src/firebaseConfig.json'));
initializeApp(config);
const db = getFirestore();

(async () => {
  // List all collections in Firestore
  console.log('Checking Firestore structure...\n');
  
  // Check projects collection
  let snap = await getDocs(collection(db, 'projects'));
  console.log(`projects collection: ${snap.size} documents`);
  let docWithJobKey = snap.docs.find(d => d.data().jobKey);
  console.log(`Documents with jobKey: ${snap.docs.filter(d => d.data().jobKey).length}`);
  if (docWithJobKey) {
    const data = docWithJobKey.data();
    console.log(`Sample (with jobKey):
  projectName: ${data.projectName}
  customer: ${data.customer}
  jobKey: ${data.jobKey}\n`);
  }
  
  // Check for unique projects (distinct by projectName)
  const projectsByName = new Map();
  snap.docs.forEach(d => {
    const data = d.data();
    const name = data.projectName;
    if (!projectsByName.has(name)) {
      projectsByName.set(name, d.data().jobKey);
    }
  });
  console.log(`Unique projectNames: ${projectsByName.size}`);
  
  // Check projectScopes collection if it exists
  try {
    snap = await getDocs(collection(db, 'projectScopes'));
    console.log(`\nprojectScopes collection: ${snap.size} documents`);
    if (snap.size > 0) {
      const sample = snap.docs[0].data();
      console.log(`Sample projectScope:`, JSON.stringify(sample, null, 2).substring(0, 200));
    }
  } catch (e) {
    console.log(`projectScopes collection: not found or error`);
  }
})();
