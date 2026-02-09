const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateStoltzfusTitles() {
  try {
    console.log('Searching for John and Abner Stoltzfus...\n');
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    
    const employees = employeesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Find John Stoltzfus
    const john = employees.find(emp => emp.firstName === 'John' && emp.lastName === 'Stoltzfus');
    if (john) {
      console.log(`Found: ${john.firstName} ${john.lastName}`);
      console.log(`  Current Role: ${john.role}`);
      
      await updateDoc(doc(db, 'employees', john.id), {
        role: 'General Manager',
        updatedAt: new Date().toISOString()
      });
      
      console.log(`  ✓ Updated to: General Manager\n`);
    } else {
      console.log('John Stoltzfus not found\n');
    }
    
    // Find Abner Stoltzfus
    const abner = employees.find(emp => emp.firstName === 'Abner' && emp.lastName === 'Stoltzfus');
    if (abner) {
      console.log(`Found: ${abner.firstName} ${abner.lastName}`);
      console.log(`  Current Role: ${abner.role}`);
      
      await updateDoc(doc(db, 'employees', abner.id), {
        role: 'Project Manager',
        updatedAt: new Date().toISOString()
      });
      
      console.log(`  ✓ Updated to: Project Manager\n`);
    } else {
      console.log('Abner Stoltzfus not found\n');
    }
    
    console.log('Updates complete!');
    
  } catch (error) {
    console.error('Error updating employees:', error);
  } finally {
    process.exit(0);
  }
}

updateStoltzfusTitles();
