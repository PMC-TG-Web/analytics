const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, setDoc, serverTimestamp } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createCollections() {
  try {
    console.log('Creating long term schedual and short term schedual collections...');
    
    // Create long term schedual collection with an initial placeholder document
    await setDoc(doc(db, 'long term schedual', '_placeholder'), {
      created: serverTimestamp(),
      description: 'Placeholder document - can be deleted after adding real data'
    });
    console.log('✓ Created "long term schedual" collection');
    
    // Create short term schedual collection with an initial placeholder document
    await setDoc(doc(db, 'short term schedual', '_placeholder'), {
      created: serverTimestamp(),
      description: 'Placeholder document - can be deleted after adding real data'
    });
    console.log('✓ Created "short term schedual" collection');
    
    console.log('\nCollections created successfully!');
    
  } catch (error) {
    console.error('Error creating collections:', error);
  } finally {
    process.exit(0);
  }
}

createCollections();
