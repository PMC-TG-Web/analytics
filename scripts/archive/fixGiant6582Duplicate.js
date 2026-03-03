const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function fix() {
  try {
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    let deleteCount = 0;
    let found= [];
    
    snapshot.forEach(doc => {
      const jobKey = doc.data().jobKey;
      const title = doc.data().title;
      if (jobKey === 'Ames Construction, Inc.~2508 - GI~Giant #6582' && title === '1,904 Sq Ft. - 5 Interior Slab on Deck') {
        found.push({ id: doc.id, title });
      }
    });
    
    console.log(`Found ${found.length} documents with duplicate scope`);
    
    // Delete all but the first one
    for (let i = 1; i < found.length; i++) {
      await deleteDoc(snapshot.docs.find(d => d.id === found[i].id).ref);
      deleteCount++;
      console.log(`✓ Deleted duplicate: "${found[i].title}"`);
    }
    
    console.log(`\n✅ Deleted ${deleteCount} duplicate documents`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fix();
