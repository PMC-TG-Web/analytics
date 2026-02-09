const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function listForemen() {
  try {
    const snapshot = await getDocs(collection(db, 'employees'));
    
    const roles = new Set();
    const foremen = [];
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.role) {
        roles.add(data.role);
      }
      
      const role = (data.role || '').toLowerCase();
      if (role.includes('foreman') || role.includes('crew') || 
          role.includes('lead') || role.includes('supervisor')) {
        foremen.push({
          id: doc.id,
          name: `${data.firstName} ${data.lastName}`,
          role: data.role
        });
      }
    });
    
    console.log('\n=== All Employee Roles ===');
    Array.from(roles).sort().forEach(role => console.log(`  - ${role}`));
    
    console.log('\n=== Potential Foremen/Crew Leaders ===');
    if (foremen.length > 0) {
      foremen.sort((a, b) => a.name.localeCompare(b.name));
      foremen.forEach(f => console.log(`  ${f.name} - ${f.role}`));
    } else {
      console.log('  No foremen found! You may need to add foreman roles to employees.');
    }
    
    console.log('');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

listForemen();
