const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectItemsStructure() {
  try {
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2508 - GI')
    );
    const snapshot = await getDocs(q);

    if (snapshot.docs.length > 0) {
      const doc = snapshot.docs[0];
      const data = doc.data();
      
      console.log('\n=== Sample items from array ===\n');
      // Show first 5 items
      data.items.slice(0, 5).forEach((item, index) => {
        console.log(`Item ${index + 1}:`);
        console.log(`  costitems: ${item.costitems}`);
        console.log(`  costType: ${item.costType}`);
        console.log(`  quantity: ${item.quantity}`);
        console.log(`  sales: ${item.sales}`);
        console.log(`  cost: ${item.cost}`);
        console.log(`  Has projectName: ${item.projectName ? 'YES' : 'NO'}`);
        console.log(`  Has customer: ${item.customer ? 'YES' : 'NO'}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

inspectItemsStructure();
