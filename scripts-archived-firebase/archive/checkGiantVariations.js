const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkGiantVariations() {
  try {
    // Check what's left with project number "2508 - GI"
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2508 - GI')
    );
    const snapshot = await getDocs(q);

    console.log(`\n=== Found ${snapshot.docs.length} documents for "2508 - GI" ===\n`);

    if (snapshot.docs.length > 0) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      
      console.log('Remaining document:');
      console.log(`  ID: ${doc.id}`);
      console.log(`  Project Number: ${data.projectNumber}`);
      console.log(`  Project Name: ${data.projectName}`);
      console.log(`  Customer: ${data.customer}`);
      console.log(`  Status: ${data.status}`);
      console.log(`  Sales: $${(data.sales || 0).toLocaleString()}`);
      console.log(`  Has items array: ${data.items ? 'YES' : 'NO'}`);
      if (data.items) {
        console.log(`  Items count: ${data.items.length}`);
        
        // Check unique project name variations in items
        const projectNames = new Set(data.items.map(item => item.projectName || data.projectName));
        const customers = new Set(data.items.map(item => item.customer || data.customer));
        
        console.log(`\n  Unique project name variations in items:`);
        projectNames.forEach(name => console.log(`    - ${name}`));
        
        console.log(`\n  Unique customers in items:`);
        customers.forEach(cust => console.log(`    - ${cust}`));
      }
    }

    // Also check if there are any documents with "Giant #6582" in the name
    console.log('\n=== Searching for any "Giant #6582" references ===\n');
    const allGiant = await getDocs(collection(db, 'projects'));
    const giant6582 = allGiant.docs.filter(doc => {
      const data = doc.data();
      return (data.projectName || '').includes('6582') || 
             (data.projectNumber || '').includes('6582');
    });

    console.log(`Found ${giant6582.length} documents containing "6582"`);
    giant6582.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${data.projectNumber}: ${data.projectName} (${data.customer})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkGiantVariations();
