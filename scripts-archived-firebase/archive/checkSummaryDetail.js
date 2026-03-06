const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkSummaryDetail() {
  const summaryDoc = await getDoc(doc(db, 'metadata', 'dashboard_summary'));
  
  if (summaryDoc.exists()) {
    const summary = summaryDoc.data();
    console.log('Full Labor Breakdown:');
    console.log(JSON.stringify(summary.laborBreakdown, null, 2));
    
    const total = Object.values(summary.laborBreakdown).reduce((sum, val) => sum + val, 0);
    console.log(`\nTotal hours in breakdown: ${total}`);
  }
  
  process.exit(0);
}

checkSummaryDetail().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
