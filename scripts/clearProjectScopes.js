const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc } = require('firebase/firestore');
const config = require(path.resolve(__dirname, '../src/firebaseConfig.json'));
initializeApp(config);
const db = getFirestore();

(async () => {
  try {
    console.log('Deleting all projectScopes documents...');
    const snap = await getDocs(collection(db, 'projectScopes'));
    let deleted = 0;
    
    for (const doc of snap.docs) {
      await deleteDoc(doc.ref);
      deleted++;
    }
    
    console.log(`✓ Deleted ${deleted} scope documents`);
    process.exit(0);
  } catch (error) {
    console.error('Error clearing documents:', error.message);
    process.exit(1);
  }
})();
