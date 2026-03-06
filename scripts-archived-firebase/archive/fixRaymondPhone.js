const { initializeApp } = require('firebase/app');
const { getFirestore, doc, updateDoc } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixRaymond() {
  try {
    const raymondId = 'emp_procore_598134329368985';
    
    await updateDoc(doc(db, 'employees', raymondId), {
      phone: '717-617-4941',
      updatedAt: new Date().toISOString()
    });
    
    console.log('✓ Updated Raymond King Jr with correct phone number: 717-617-4941');
    
  } catch (error) {
    console.error('Error updating Raymond:', error);
  } finally {
    process.exit(0);
  }
}

fixRaymond();
