const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function countScopes() {
  try {
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    console.log(`Total scope documents in Firestore: ${snapshot.size}`);
    
    // Show a few samples
    let count = 0;
    snapshot.forEach(doc => {
      if (count < 5) {
        console.log(`  - ${doc.data().jobKey}: "${doc.data().title}"`);
        count++;
      }
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

countScopes();
