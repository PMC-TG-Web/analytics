const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, updateDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixBadAllocations() {
  try {
    console.log('\n========================================');
    console.log('Fixing Bad Allocations');
    console.log('========================================\n');

    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    let fixedCount = 0;
    
    for (const doc of schedulesSnapshot.docs) {
      const data = doc.data();
      const allocations = data.allocations;
      
      if (!allocations || typeof allocations !== 'object') continue;
      
      const entries = Object.entries(allocations);
      let hasNaN = false;
      
      entries.forEach(([month, percent]) => {
        if (isNaN(Number(percent))) {
          hasNaN = true;
        }
      });
      
      if (hasNaN) {
        // Try to fix the allocations
        let fixed = {};
        
        entries.forEach(([month, value]) => {
          // If value is an object with month/percent, extract it
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.percent !== undefined) {
              fixed[month] = Number(value.percent) || 0;
            } else {
              fixed[month] = 0;
            }
          } else if (Array.isArray(value)) {
            // If it's an array, just set to 0
            fixed[month] = 0;
          } else {
            // Try to convert to number
            const num = Number(value);
            fixed[month] = isNaN(num) ? 0 : num;
          }
        });
        
        await updateDoc(doc.ref, {
          allocations: fixed
        });
        
        fixedCount++;
        if (fixedCount <= 5) {
          console.log(`✓ Fixed: ${data.projectName}`);
        }
      }
    }
    
    console.log(`\n========================================`);
    console.log(`✓ Fixed ${fixedCount} schedules with bad allocations`);
    console.log(`========================================\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixBadAllocations();
