const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateAlvinToLeadForeman() {
  try {
    console.log('Searching for Alvin Huyard...');
    
    const snapshot = await getDocs(collection(db, 'employees'));
    
    let alvinDoc = null;
    let alvinId = null;
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.firstName === 'Alvin' && data.lastName === 'Huyard') {
        alvinDoc = data;
        alvinId = doc.id;
      }
    });
    
    if (!alvinDoc) {
      console.error('Alvin Huyard not found in employees collection');
      process.exit(1);
    }
    
    console.log(`Found: ${alvinDoc.firstName} ${alvinDoc.lastName}`);
    console.log(`Current role: ${alvinDoc.role}`);
    console.log(`Updating to: Lead foreman`);
    
    const docRef = doc(db, 'employees', alvinId);
    await updateDoc(docRef, {
      role: 'Lead foreman'
    });
    
    console.log('✓ Successfully updated Alvin Huyard to Lead foreman');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

updateAlvinToLeadForeman();
