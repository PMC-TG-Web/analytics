const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findStevenFeedMill() {
  try {
    const snapshot = await getDocs(collection(db, 'projects'));
    const matches = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const projectName = (data.projectName || '').toLowerCase();
      const customer = (data.customer || '').toLowerCase();
      
      // Search for steven, feed mill, or schoeneck
      if (projectName.includes('steven') || 
          projectName.includes('feed mill') || 
          projectName.includes('schoeneck') || 
          (customer.includes('hoover') && (projectName.includes('steven') || projectName.includes('feed') || projectName.includes('schoeneck')))) {
        matches.push({
          id: doc.id,
          customer: data.customer,
          projectNumber: data.projectNumber,
          projectName: data.projectName,
          status: data.status,
          hours: data.hours || 0,
          sales: data.sales || 0,
          cost: data.cost || 0
        });
      }
    });
    
    console.log(`\nFound ${matches.length} matching projects:\n`);
    
    if (matches.length === 0) {
      console.log('No projects found matching "steven feed mill Schoeneck"');
      console.log('\nTrying broader search for all Hoover projects...\n');
      
      const hooverMatches = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        const customer = (data.customer || '').toLowerCase();
        if (customer.includes('hoover')) {
          hooverMatches.push({
            customer: data.customer,
            projectNumber: data.projectNumber,
            projectName: data.projectName,
            status: data.status
          });
        }
      });
      
      console.log(`Found ${hooverMatches.length} Hoover Building Specialists projects:\n`);
      hooverMatches.forEach((p, i) => {
        console.log(`${i + 1}. ${p.projectName} (${p.projectNumber})`);
        console.log(`   Status: ${p.status}`);
      });
    } else {
      matches.forEach((p, i) => {
        console.log(`${i + 1}. ${p.customer}`);
        console.log(`   Project: ${p.projectName}`);
        console.log(`   Number: ${p.projectNumber}`);
        console.log(`   Status: ${p.status}`);
        console.log(`   Hours: ${p.hours.toLocaleString()}`);
        console.log(`   Sales: $${p.sales.toLocaleString()}`);
        console.log(`   Cost: $${p.cost.toLocaleString()}`);
        console.log('');
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findStevenFeedMill();
