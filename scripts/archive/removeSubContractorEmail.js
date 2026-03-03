const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function removeSubContractorEmail() {
  try {
    console.log('Searching for Sub Contractor...\n');
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    
    const subContractor = employeesSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .find(emp => emp.firstName === 'Sub' && emp.lastName === 'Contractor');
    
    if (subContractor) {
      console.log(`Found: ${subContractor.firstName} ${subContractor.lastName}`);
      console.log(`  Current Email: ${subContractor.email}`);
      
      await updateDoc(doc(db, 'employees', subContractor.id), {
        email: '',
        updatedAt: new Date().toISOString()
      });
      
      console.log(`  ✓ Email removed\n`);
    } else {
      console.log('Sub Contractor not found\n');
    }
    
    console.log('Update complete!');
    
  } catch (error) {
    console.error('Error updating employee:', error);
  } finally {
    process.exit(0);
  }
}

removeSubContractorEmail();
