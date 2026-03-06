const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkAllSchedules() {
  try {
    console.log('\n========================================');
    console.log('Checking All Schedules');
    console.log('========================================\n');

    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    console.log(`Total schedules: ${schedulesSnapshot.docs.length}\n`);
    
    const withoutJobKey = [];
    const withTildes = [];
    const withPipes = [];
    
    schedulesSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (!data.jobKey) {
        withoutJobKey.push(data.projectName);
      } else if (data.jobKey.includes('~')) {
        withTildes.push(data.projectName);
      } else if (data.jobKey.includes('|')) {
        withPipes.push(data.projectName);
      }
    });
    
    console.log(`With tildes (~): ${withTildes.length}`);
    console.log(`With pipes (|): ${withPipes.length}`);
    console.log(`Without jobKey: ${withoutJobKey.length}\n`);
    
    if (withoutJobKey.length > 0) {
      console.log('Schedules WITHOUT jobKey:');
      withoutJobKey.forEach(name => console.log(`  - ${name}`));
    }
    
    console.log('\n========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAllSchedules();
