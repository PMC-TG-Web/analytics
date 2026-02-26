const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkCostItems() {
  const jobKey = "Ames Construction, Inc.~2508 - GI~Giant #6582";
  
  console.log(`\nSearching for cost items in Giant #6582...`);
  console.log(`JobKey: ${jobKey}\n`);
  
  const q = query(collection(db, 'projects'), where('jobKey', '==', jobKey));
  const projectsSnapshot = await getDocs(q);
  
  console.log(`Found ${projectsSnapshot.size} project documents\n`);
  
  const targetCostItems = ['slab on grade labor', 'travel labor', 'management'];
  
  projectsSnapshot.forEach(doc => {
    const data = doc.data();
    console.log(`Project: ${data.projectName}`);
    console.log(`Cost items: ${JSON.stringify(data.costitems, null, 2)}`);
    console.log(`Hours: ${data.hours}`);
    console.log(`Cost Type: ${data.costType || 'N/A'}`);
    console.log(`---`);
  });
  
  console.log(`\n\nSearching for specific cost items:`);
  targetCostItems.forEach(item => {
    console.log(`\nLooking for: "${item}"`);
    let found = false;
    projectsSnapshot.forEach(doc => {
      const data = doc.data();
      const costItems = data.costitems?.toLowerCase() || '';
      if (costItems.includes(item)) {
        console.log(`  ✓ Found in: ${data.costitems}`);
        console.log(`    Hours: ${data.hours}`);
        console.log(`    Cost Type: ${data.costType}`);
        found = true;
      }
    });
    if (!found) {
      console.log(`  ✗ Not found`);
    }
  });
  
  process.exit(0);
}

checkCostItems().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
