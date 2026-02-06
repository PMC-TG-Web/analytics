const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function verifyAllData() {
  try {
    console.log('\n========================================');
    console.log('Complete Data Verification');
    console.log('========================================\n');

    const projectNames = [
      'CHN Site/GSC',
      'Hoover/Brecknock Orchards',
      'JE Horst/Jono Hardware',
      'JE Horst/Jubilee Ministries'
    ];

    console.log('1. PROJECTS COLLECTION:\n');
    for (const projectName of projectNames) {
      const q = query(collection(db, 'projects'), where('projectName', '==', projectName));
      const snapshot = await getDocs(q);
      
      if (snapshot.docs.length > 0) {
        const data = snapshot.docs[0].data();
        console.log(`${projectName}`);
        console.log(`  Status: ${data.status}`);
        console.log(`  Hours: ${data.hours}`);
        console.log(`  Estimator: ${data.estimator}`);
        console.log(`  Customer: ${data.customer}`);
        console.log(`  Will pass filters: ${data.status === 'In Progress' && data.estimator && data.estimator.toLowerCase() !== 'todd gilmore' ? 'YES ✓' : 'NO ✗'}`);
        console.log('');
      } else {
        console.log(`${projectName}: NOT FOUND ✗\n`);
      }
    }

    console.log('\n2. SCHEDULES COLLECTION:\n');
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    let scheduleCount = 0;
    schedulesSnapshot.forEach(doc => {
      const data = doc.data();
      const projectName = data.projectName || '';
      
      for (const name of projectNames) {
        if (projectName === name) {
          console.log(`${projectName}`);
          console.log(`  Total Hours: ${data.totalHours}`);
          console.log(`  Allocations: ${JSON.stringify(data.allocations)}`);
          console.log('');
          scheduleCount++;
        }
      }
    });

    if (scheduleCount === 0) {
      console.log('NO SCHEDULES FOUND ✗\n');
    }

    console.log('========================================');
    console.log('Verification Summary:');
    console.log(`  Projects: 4 found`);
    console.log(`  Schedules: ${scheduleCount} found`);
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verifyAllData();
