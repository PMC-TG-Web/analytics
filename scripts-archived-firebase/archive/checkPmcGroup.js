const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, limit } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkPmcGroup() {
  const q = query(collection(db, 'projects'), where('status', '==', 'Bid Submitted'), limit(50));
  const snapshot = await getDocs(q);
  
  console.log('Sample Bid Submitted projects with pmcGroup:\n');
  let hasPmcGroup = 0;
  let noPmcGroup = 0;
  
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const pmcVal = data.pmcGroup || 'EMPTY';
    console.log(`${data.customer} - ${data.projectName}: pmcGroup="${pmcVal}"`);
    if (data.pmcGroup) hasPmcGroup++;
    else noPmcGroup++;
  });
  
  console.log(`\nSummary:`);
  console.log(`  Have pmcGroup: ${hasPmcGroup}`);
  console.log(`  Missing pmcGroup: ${noPmcGroup}`);
  
  process.exit(0);
}

checkPmcGroup().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
