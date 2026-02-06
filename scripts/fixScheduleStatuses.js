const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, updateDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixScheduleStatuses() {
  try {
    console.log('\n========================================');
    console.log('Fixing Schedule Status Fields');
    console.log('========================================\n');

    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    let updatedCount = 0;
    let noStatusCount = 0;
    
    for (const doc of schedulesSnapshot.docs) {
      const data = doc.data();
      
      if (!data.status || data.status === undefined) {
        // Determine status from projectName
        // If no projectName is in the exclusion list, it's In Progress
        const projectName = (data.projectName || '').toLowerCase();
        const status = 'In Progress'; // Default to In Progress for all
        
        await updateDoc(doc.ref, {
          status: status
        });
        
        noStatusCount++;
        if (noStatusCount <= 10) { // Show first 10
          console.log(`✓ Fixed: ${data.projectName} → In Progress`);
        }
        updatedCount++;
      }
    }
    
    console.log(`\n========================================`);
    console.log(`✓ Fixed ${updatedCount} schedules missing status field`);
    console.log(`========================================\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixScheduleStatuses();
