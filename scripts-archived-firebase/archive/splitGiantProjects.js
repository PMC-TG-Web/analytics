const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function splitGiantProjects() {
  try {
    console.log('\n=== Splitting Giant Projects by Name + Customer ===\n');
    
    // Get the consolidated document
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2508 - GI')
    );
    const snapshot = await getDocs(q);
    
    if (snapshot.docs.length === 0) {
      console.log('No consolidated document found');
      process.exit(0);
    }
    
    const consolidatedDoc = snapshot.docs[0];
    const consolidatedData = consolidatedDoc.data();
    
    console.log(`Found consolidated document with ${consolidatedData.items?.length || 0} items`);
    
    if (!consolidatedData.items) {
      console.log('No items array found. Cannot split.');
      process.exit(0);
    }
    
    // We need to re-query the original CSV or reconstruct from what we have
    // Since we lost the metadata, let's keep the consolidated version but update the status
    console.log('\n⚠️  Cannot split without original document metadata');
    console.log('The original project names and customers were not preserved in the items array.');
    console.log('\nOptions:');
    console.log('1. Re-import from CSV to restore original structure');
    console.log('2. Keep consolidated version and update status if needed');
    console.log('\nWhat is the correct status for this project?');
    console.log(`Current status: ${consolidatedData.status}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

splitGiantProjects();
