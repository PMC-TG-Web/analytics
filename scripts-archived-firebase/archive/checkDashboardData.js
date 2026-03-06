const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkTotals() {
  const snapshot = await getDocs(collection(db, 'projects'));
  const projects = snapshot.docs.map(doc => doc.data());
  
  console.log('Total projects:', projects.length);
  
  // Check statuses
  const statuses = {};
  projects.forEach(p => {
    const status = p.status || 'Unknown';
    statuses[status] = (statuses[status] || 0) + 1;
  });
  
  console.log('\nStatus counts:');
  Object.entries(statuses).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  
  // Check if hours field exists
  const withHours = projects.filter(p => p.hours && p.hours > 0).length;
  const withPmcGroup = projects.filter(p => p.pmcGroup).length;
  
  console.log(`\nProjects with hours > 0: ${withHours}`);
  console.log(`Projects with pmcGroup: ${withPmcGroup}`);
  
  // Calculate totals
  const totalSales = projects.reduce((sum, p) => sum + (Number(p.sales) || 0), 0);
  const totalHours = projects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  
  console.log(`\nTotal Sales: $${totalSales.toLocaleString()}`);
  console.log(`Total Hours: ${totalHours.toLocaleString()}`);
  
  process.exit(0);
}

checkTotals().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
