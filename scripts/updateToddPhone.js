const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateToddPhone() {
  try {
    console.log('Searching for Todd Gilmore...');
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    console.log(`Found ${employeesSnapshot.docs.length} employees`);
    
    const todd = employeesSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .find(emp => emp.firstName === 'Todd' && emp.lastName === 'Gilmore');
    
    if (todd) {
      console.log(`Found: ${todd.firstName} ${todd.lastName}, Current phone: ${todd.phone}`);
      await updateDoc(doc(db, 'employees', todd.id), {
        phone: '717-802-9344',
        updatedAt: new Date().toISOString()
      });
      
      console.log('✓ Updated Todd Gilmore\'s phone number to: 717-802-9344');
    } else {
      console.log('Todd Gilmore not found');
    }
    
  } catch (error) {
    console.error('Error updating phone:', error);
  } finally {
    process.exit(0);
  }
}

updateToddPhone();
