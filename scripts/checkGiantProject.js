const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkGiantProject() {
  try {
    // Query for project "2508 - GI" (Giant)
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2508 - GI')
    );
    const snapshot = await getDocs(q);

    console.log(`\n=== Found ${snapshot.docs.length} documents for "2508 - GI" ===\n`);

    snapshot.docs.forEach((doc, index) => {
      const data = doc.data();
      console.log(`Document ${index + 1}:`);
      console.log(`  ID: ${doc.id}`);
      console.log(`  Project Name: ${data.projectName}`);
      console.log(`  Customer: ${data.customer}`);
      console.log(`  Sales: $${(data.sales || 0).toLocaleString()}`);
      console.log(`  Cost: $${(data.cost || 0).toLocaleString()}`);
      console.log(`  Has items array: ${data.items ? 'YES' : 'NO'}`);
      if (data.items) {
        console.log(`  Items array length: ${data.items.length}`);
        
        // Check for duplicates in items array
        const itemNames = data.items.map(item => item.costitems);
        const duplicates = itemNames.filter((item, index) => itemNames.indexOf(item) !== index);
        if (duplicates.length > 0) {
          console.log(`  ⚠️  DUPLICATES FOUND IN ITEMS ARRAY:`);
          const uniqueDupes = [...new Set(duplicates)];
          uniqueDupes.forEach(dupe => {
            const count = itemNames.filter(name => name === dupe).length;
            console.log(`     - "${dupe}" appears ${count} times`);
          });
        }
      }
      console.log(`  Cost Type: ${data.costType || 'N/A'}`);
      console.log(`  Cost Items: ${data.costitems || 'N/A'}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkGiantProject();
