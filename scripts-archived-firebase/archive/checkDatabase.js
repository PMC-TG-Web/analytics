// scripts/checkDatabase.js
// Usage: node scripts/checkDatabase.js

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkDatabase() {
  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    // Get all documents from projects collection
    const querySnapshot = await getDocs(collection(db, 'projects'));
    
    console.log(`\nTotal documents in 'projects' collection: ${querySnapshot.size}\n`);
    
    if (querySnapshot.size > 0) {
      // Show first 5 documents as sample
      const samples = [];
      querySnapshot.docs.slice(0, 5).forEach(doc => {
        samples.push({ id: doc.id, ...doc.data() });
      });
      
      console.log('Sample documents:');
      console.log(JSON.stringify(samples, null, 2));
      
      // Show field structure from first document
      if (samples.length > 0) {
        console.log('\nFields in documents:');
        console.log(Object.keys(samples[0]).filter(k => k !== 'id').join(', '));
      }
    } else {
      console.log('No documents found in the projects collection.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking database:', error);
    process.exit(1);
  }
}

checkDatabase();
