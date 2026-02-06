const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, doc, updateDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fixProjectStatuses() {
  try {
    console.log('\n========================================');
    console.log('Fixing Project Statuses');
    console.log('========================================\n');

    const projectNames = [
      'CHN Site/GSC',
      'Hoover/Brecknock Orchards',
      'JE Horst/Jono Hardware',
      'JE Horst/Jubilee Ministries'
    ];

    let updatedCount = 0;

    for (const projectName of projectNames) {
      const q = query(collection(db, 'projects'), where('projectName', '==', projectName));
      const snapshot = await getDocs(q);
      
      if (snapshot.docs.length > 0) {
        const docSnap = snapshot.docs[0];
        const docRef = doc(db, 'projects', docSnap.id);

        await updateDoc(docRef, {
          status: 'In Progress',
          dateUpdated: new Date().toISOString()
        });

        console.log(`✓ Updated: ${projectName}`);
        console.log(`  Status: In Process → In Progress\n`);
        updatedCount++;
      }
    }

    console.log('========================================');
    console.log(`✓ Successfully updated ${updatedCount} projects`);
    console.log('✓ Status changed from "In Process" to "In Progress"');
    console.log('✓ Projects should now appear on scheduling page');
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixProjectStatuses();
