const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

// Load Firebase config
const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkStatusDistribution() {
  console.log('Fetching all projects from Firestore...\n');
  
  const snapshot = await getDocs(collection(db, 'projects'));
  const projects = snapshot.docs.map(doc => doc.data());
  
  console.log(`Total documents: ${projects.length}`);
  
  // Count status values
  const statusCounts = {};
  projects.forEach(p => {
    const status = (p.status || '').trim();
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  
  console.log('\nStatus distribution:');
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log(`  "${status}": ${count}`);
    });
  
  // Calculate totals by status
  console.log('\n\nSales by status:');
  const salesByStatus = {};
  projects.forEach(p => {
    const status = (p.status || '').trim();
    const salesStr = (p.sales || '').toString().replace(/[$,\s]/g, '');
    const sales = parseFloat(salesStr) || 0;
    salesByStatus[status] = (salesByStatus[status] || 0) + sales;
  });
  
  Object.entries(salesByStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, total]) => {
      console.log(`  "${status}": $${total.toLocaleString()}`);
    });
  
  process.exit(0);
}

checkStatusDistribution().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
