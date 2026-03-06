const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

// Load Firebase config
const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkBidSubmittedProjects() {
  console.log('Querying Firestore for Bid Submitted/Estimating projects...\n');
  
  // Query for Bid Submitted
  const q1 = query(collection(db, 'projects'), where('status', '==', 'Bid Submitted'));
  const snapshot1 = await getDocs(q1);
  
  // Query for Estimating
  const q2 = query(collection(db, 'projects'), where('status', '==', 'Estimating'));
  const snapshot2 = await getDocs(q2);
  
  const allDocs = [...snapshot1.docs, ...snapshot2.docs];
  console.log(`Found ${allDocs.length} line items with Bid Submitted or Estimating status`);
  
  // Calculate totals
  let totalSales = 0;
  const projects = [];
  
  allDocs.forEach(doc => {
    const data = doc.data();
    const sales = Number(data.sales || 0);
    totalSales += sales;
    projects.push({
      customer: data.customer,
      projectNumber: data.projectNumber,
      projectName: data.projectName,
      status: data.status,
      sales,
      costitems: data.costitems
    });
  });
  
  console.log(`Total sales (raw line items): $${totalSales.toLocaleString()}`);
  
  // Group by project key for deduplication count
  const projectKeys = new Set();
  projects.forEach(p => {
    const key = `${p.customer}|${p.projectNumber}|${p.projectName}`.toLowerCase();
    projectKeys.add(key);
  });
  
  console.log(`Unique projects (by customer|projectNumber|projectName): ${projectKeys.size}`);
  
  // Show first 10 samples
  console.log('\nFirst 10 projects:');
  projects.slice(0, 10).forEach(p => {
    console.log(`  ${p.customer} - ${p.projectName} (${p.status}): $${p.sales.toLocaleString()}`);
  });
  
  process.exit(0);
}

checkBidSubmittedProjects().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
