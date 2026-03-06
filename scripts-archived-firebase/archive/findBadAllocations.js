const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findBadAllocations() {
  try {
    console.log('\n========================================');
    console.log('Finding Bad Allocations');
    console.log('========================================\n');

    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    let undefinedCount = 0;
    let nullCount = 0;
    let notObjectCount = 0;
    let nanCount = 0;
    let problemProjects = [];
    
    schedulesSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const allocations = data.allocations;
      
      // Check if allocations is valid
      if (allocations === undefined) {
        undefinedCount++;
        problemProjects.push(`${data.projectName}: UNDEFINED`);
      } else if (allocations === null) {
        nullCount++;
        problemProjects.push(`${data.projectName}: NULL`);
      } else if (!allocations || typeof allocations !== 'object') {
        notObjectCount++;
        problemProjects.push(`${data.projectName}: not an object (${typeof allocations})`);
      } else {
        // Check values
        const entries = Object.entries(allocations);
        entries.forEach(([month, percent]) => {
          if (isNaN(Number(percent))) {
            nanCount++;
            problemProjects.push(`${data.projectName}: month "${month}" has NaN value "${percent}"`);
          }
        });
      }
    });
    
    console.log(`Undefined: ${undefinedCount}`);
    console.log(`Null: ${nullCount}`);
    console.log(`Not Object: ${notObjectCount}`);
    console.log(`NaN values: ${nanCount}\n`);
    
    if (problemProjects.length > 0) {
      console.log('Problems:');
      problemProjects.slice(0, 20).forEach(p => console.log(`  ${p}`));
      if (problemProjects.length > 20) {
        console.log(`  ... and ${problemProjects.length - 20} more`);
      }
    }
    
    console.log('\n========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findBadAllocations();
