const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkGiantSales() {
  try {
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2508 - GI')
    );
    const snapshot = await getDocs(q);

    console.log(`\n=== Found ${snapshot.docs.length} Giant documents ===\n`);

    let totalSales = 0;
    let zeroSales = 0;
    
    snapshot.docs.slice(0, 10).forEach((doc, index) => {
      const data = doc.data();
      console.log(`Document ${index + 1}:`);
      console.log(`  Project Name: ${data.projectName}`);
      console.log(`  Customer: ${data.customer}`);
      console.log(`  Status: ${data.status}`);
      console.log(`  Cost Item: ${data.costitems}`);
      console.log(`  Sales: ${data.sales}`);
      console.log(`  Cost: ${data.cost}`);
      console.log('');
      
      totalSales += data.sales || 0;
      if ((data.sales || 0) === 0) zeroSales++;
    });
    
    console.log(`Total sales from first 10: $${totalSales.toLocaleString()}`);
    console.log(`Documents with zero sales: ${zeroSales}/10`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkGiantSales();
