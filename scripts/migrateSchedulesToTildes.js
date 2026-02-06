const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateSchedulesToTildes() {
  try {
    console.log('\n========================================');
    console.log('Migrating Schedules to Tilde Format');
    console.log('========================================\n');

    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    console.log(`Found ${schedulesSnapshot.docs.length} schedules\n`);
    
    let updatedCount = 0;
    
    for (const doc of schedulesSnapshot.docs) {
      const data = doc.data();
      const oldJobKey = data.jobKey;
      
      if (!oldJobKey) {
        console.log(`⚠ Skipped: Document has no jobKey`);
        continue;
      }
      
      // Convert pipes to tildes
      const newJobKey = oldJobKey.replace(/\|/g, '~');
      
      if (oldJobKey !== newJobKey) {
        await updateDoc(doc.ref, {
          jobKey: newJobKey
        });
        
        console.log(`✓ Updated: ${oldJobKey}`);
        console.log(`  To:      ${newJobKey}`);
        updatedCount++;
      }
    }
    
    console.log('\n========================================');
    console.log(`✓ Successfully migrated ${updatedCount} schedules`);
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

migrateSchedulesToTildes();
