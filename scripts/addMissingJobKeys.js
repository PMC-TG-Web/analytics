const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, updateDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function addMissingJobKeys() {
  try {
    console.log('\n========================================');
    console.log('Adding Missing jobKey Fields');
    console.log('========================================\n');

    const projectsToFix = [
      { projectName: 'CHN Site/GSC', customer: 'CHN Site', projectNumber: null },
      { projectName: 'Hoover/Brecknock Orchards', customer: 'Hoover', projectNumber: null },
      { projectName: 'JE Horst/Jono Hardware', customer: 'JE Horst', projectNumber: null },
      { projectName: 'JE Horst/Jubilee Ministries', customer: 'JE Horst', projectNumber: null }
    ];

    let updatedCount = 0;

    for (const project of projectsToFix) {
      const q = query(collection(db, 'schedules'), where('projectName', '==', project.projectName));
      const snapshot = await getDocs(q);
      
      if (snapshot.docs.length > 0) {
        const doc = snapshot.docs[0];
        const jobKey = `${project.customer}~${project.projectNumber || ''}~${project.projectName}`;
        
        await updateDoc(doc.ref, {
          jobKey: jobKey
        });
        
        console.log(`✓ Added jobKey to: ${project.projectName}`);
        console.log(`  jobKey: ${jobKey}\n`);
        updatedCount++;
      }
    }

    console.log('========================================');
    console.log(`✓ Successfully updated ${updatedCount} schedules`);
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addMissingJobKeys();
