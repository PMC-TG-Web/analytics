const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function listEmployeeRoles() {
  try {
    const snapshot = await getDocs(collection(db, 'employees'));
    
    const roleCounts = {};
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const role = data.role || 'No Role';
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    });
    
    console.log('\n=== Employee Role Distribution ===');
    Object.entries(roleCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([role, count]) => {
        console.log(`  ${role}: ${count} employee(s)`);
      });
    
    console.log(`\nTotal employees: ${snapshot.docs.length}\n`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

listEmployeeRoles();
