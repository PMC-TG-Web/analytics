const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkSchedulesForProjects() {
  try {
    console.log('\n========================================');
    console.log('Checking Schedule Entries');
    console.log('========================================\n');

    const projectNames = [
      'CHN Site/GSC',
      'Hoover/Brecknock Orchards',
      'JE Horst/Jono Hardware',
      'JE Horst/Jubilee Ministries'
    ];

    // First check projects collection
    console.log('Projects in database:\n');
    for (const projectName of projectNames) {
      const q = query(collection(db, 'projects'), where('projectName', '==', projectName));
      const snapshot = await getDocs(q);
      
      if (snapshot.docs.length > 0) {
        const data = snapshot.docs[0].data();
        console.log(`✓ ${projectName}`);
        console.log(`  Hours: ${data.hours}`);
        console.log(`  Status: ${data.status}`);
        console.log(`  Doc ID: ${snapshot.docs[0].id}\n`);
      }
    }

    // Now check schedules collection
    console.log('\nSchedule entries in database:\n');
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    let found = 0;
    schedulesSnapshot.forEach(doc => {
      const data = doc.data();
      const projectName = data.projectName || '';
      
      for (const name of projectNames) {
        if (projectName === name) {
          console.log(`✓ ${projectName}`);
          console.log(`  Allocations: ${JSON.stringify(data.allocations)}`);
          console.log(`  Schedule Doc ID: ${doc.id}\n`);
          found++;
        }
      }
    });

    if (found === 0) {
      console.log('✗ No schedule entries found for these projects');
      console.log('  This is why hours aren\'t showing on scheduling page');
      console.log('  Need to create schedule entries for these projects\n');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSchedulesForProjects();
