const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkLaborHours() {
  console.log('Fetching dashboard summary...');
  const summaryDoc = await getDoc(doc(db, 'metadata', 'dashboard_summary'));
  
  if (summaryDoc.exists()) {
    const summary = summaryDoc.data();
    console.log('\n=== Dashboard Summary ===');
    console.log('Total Hours:', summary.totalHours);
    console.log('\nLabor Breakdown:');
    if (summary.laborBreakdown) {
      Object.entries(summary.laborBreakdown).forEach(([group, hours]) => {
        console.log(`  ${group}: ${hours}`);
      });
    } else {
      console.log('  No labor breakdown found');
    }
  } else {
    console.log('No dashboard summary found');
  }
  
  console.log('\n=== Checking Projects ===');
  const snapshot = await getDocs(collection(db, 'projects'));
  const allProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  const bidSubmitted = allProjects.filter(p => p.status === 'Bid Submitted');
  console.log(`Total projects: ${allProjects.length}`);
  console.log(`Bid Submitted projects: ${bidSubmitted.length}`);
  
  const withPmcGroup = bidSubmitted.filter(p => p.pmcGroup);
  console.log(`Bid Submitted with pmcGroup: ${withPmcGroup.length}`);
  
  const laborGroups = ['slab on grade labor', 'site concrete labor', 'wall labor', 'foundation labor'];
  const withLaborGroup = bidSubmitted.filter(p => {
    const group = (p.pmcGroup || '').toLowerCase();
    return laborGroups.includes(group);
  });
  console.log(`Bid Submitted with labor pmcGroup: ${withLaborGroup.length}`);
  
  const totals = {
    'slab on grade labor': 0,
    'site concrete labor': 0,
    'wall labor': 0,
    'foundation labor': 0,
  };
  
  bidSubmitted.forEach(p => {
    const group = (p.pmcGroup || '').toLowerCase();
    if (laborGroups.includes(group)) {
      totals[group] += (Number(p.hours) || 0);
    }
  });
  
  console.log('\nBid Submitted Labor Hours by Group:');
  Object.entries(totals).forEach(([group, hours]) => {
    console.log(`  ${group}: ${hours}`);
  });
  
  console.log('\n=== Sample Bid Submitted Projects ===');
  const samples = bidSubmitted.slice(0, 10);
  samples.forEach(p => {
    console.log(`  ${p.projectName || 'No name'}: pmcGroup="${p.pmcGroup || 'NONE'}", hours=${p.hours || 0}`);
  });
  
  process.exit(0);
}

checkLaborHours().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
