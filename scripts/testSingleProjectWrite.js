const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function test() {
  try {
    console.log('Attempting to write single document to projects collection...');
    
    const doc = {
      projectNumber: "CB - 25 - 001",
      projectName: "Crossroads Beverage",
      customer: "Wohlsen Construction Company",
      status: "Lost",
      sales: 2079768.5,
      cost: 1563735.72,
      hours: 0,
      dateCreated: "4/2/2025",
      estimator: "Steffy Rick"
    };
    
    console.log('Document:', JSON.stringify(doc, null, 2));
    
    const ref = await addDoc(collection(db, 'projects'), doc);
    console.log('✓ Success! Document ID:', ref.id);
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    console.error('Code:', error.code);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

test();
