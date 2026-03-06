const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, doc, updateDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateProjectEstimators() {
  try {
    console.log('\n========================================');
    console.log('Updating Project Estimators');
    console.log('========================================\n');

    const projectUpdates = [
      { projectName: 'CHN Site/GSC', estimator: 'Isaac' },
      { projectName: 'Hoover/Brecknock Orchards', estimator: 'Hoover' },
      { projectName: 'JE Horst/Jono Hardware', estimator: 'JE Horst' },
      { projectName: 'JE Horst/Jubilee Ministries', estimator: 'JE Horst' }
    ];

    let updatedCount = 0;

    for (const update of projectUpdates) {
      const q = query(collection(db, 'projects'), where('projectName', '==', update.projectName));
      const snapshot = await getDocs(q);
      
      if (snapshot.docs.length > 0) {
        const docSnap = snapshot.docs[0];
        const docRef = doc(db, 'projects', docSnap.id);

        await updateDoc(docRef, {
          estimator: update.estimator,
          dateUpdated: new Date().toISOString()
        });

        console.log(`✓ Updated: ${update.projectName}`);
        console.log(`  Estimator: ${update.estimator}\n`);
        updatedCount++;
      }
    }

    console.log('========================================');
    console.log(`✓ Successfully updated ${updatedCount} projects`);
    console.log('✓ Projects should now appear on scheduling page');
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateProjectEstimators();
