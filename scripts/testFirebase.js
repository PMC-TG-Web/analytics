const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');

console.log('Config:', JSON.stringify(firebaseConfig, null, 2));

try {
  const app = initializeApp(firebaseConfig);
  console.log('✓ App initialized');
  
  const db = getFirestore(app);
  console.log('✓ Firestore initialized');
  
  // Try to add a test document
  addDoc(collection(db, 'test'), { hello: 'world' })
    .then(ref => {
      console.log('✓ Test write succeeded, doc id:', ref.id);
      process.exit(0);
    })
    .catch(err => {
      console.error('✗ Test write failed:', err.message);
      console.error('Error code:', err.code);
      process.exit(1);
    });
} catch (error) {
  console.error('✗ Init error:', error.message);
  process.exit(1);
}
