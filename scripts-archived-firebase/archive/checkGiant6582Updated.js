const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkGiant6582() {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, 'projectScopes'),
        where('jobKey', '>=', 'Ames Construction, Inc.~2508 - GI~Giant #6582'),
        where('jobKey', '<=', 'Ames Construction, Inc.~2508 - GI~Giant #6582\uf8ff')
      )
    );
    
    console.log(`\nGiant #6582 (Ames Construction) has ${snapshot.size} separate scope documents:\n`);
    
    snapshot.forEach((doc, idx) => {
      const data = doc.data();
      console.log(`${idx + 1}. "${data.title}"`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkGiant6582();
