const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function showEmployee() {
  try {
    console.log('Fetching employees...');
    const employeesSnapshot = await getDocs(collection(db, 'employees'));
    console.log(`Found ${employeesSnapshot.docs.length} employees\n`);
    
    // Look for any King with Raymond
    const kings = employeesSnapshot.docs
      .map(doc => doc.data())
      .filter(emp => emp.firstName.includes('Raymond') || emp.lastName.includes('King'));
    
    console.log('All Kings or Raymonds:');
    kings.forEach(k => console.log(`  - ${k.firstName} ${k.lastName}`));
    
    const raymond = employeesSnapshot.docs
      .map(doc => doc.data())
      .find(emp => emp.firstName === 'Raymond' || (emp.firstName.includes('Raymond')));
    
    if (raymond) {
      console.log('\n========================================');
      console.log('RAYMOND KING JR - EMPLOYEE DETAILS');
      console.log('========================================\n');
      console.log(`Name:        ${raymond.firstName} ${raymond.lastName}`);
      console.log(`Email:       ${raymond.email}`);
      console.log(`Phone:       ${raymond.phone || 'N/A'}`);
      console.log(`Role:        ${raymond.role}`);
      console.log(`Department:  ${raymond.department}`);
      console.log(`Status:      ${raymond.isActive ? 'Active' : 'Inactive'}`);
      console.log(`Hourly Rate: ${raymond.hourlyRate ? `$${raymond.hourlyRate}` : 'Not set'}`);
      console.log(`Hire Date:   ${raymond.hireDate || 'Not set'}`);
      console.log(`\nNotes:`);
      console.log(raymond.notes || 'None');
      console.log('\n========================================\n');
    } else {
      console.log('\nRaymond not found in any form');
    }
    
  } catch (error) {
    console.error('Error fetching employee:', error);
  } finally {
    process.exit(0);
  }
}

showEmployee();
