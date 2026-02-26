const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkSchedulesFormat() {
  try {
    console.log('\n========================================');
    console.log('Checking Schedules Format');
    console.log('========================================\n');

    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    console.log(`Total schedules: ${schedulesSnapshot.docs.length}\n`);
    
    schedulesSnapshot.docs.forEach((doc, index) => {
      const data = doc.data();
      console.log(`${index + 1}. Doc ID: ${doc.id}`);
      console.log(`   jobKey: ${data.jobKey}`);
      console.log(`   projectName: ${data.projectName}`);
      console.log(`   totalHours: ${data.totalHours}`);
      console.log(`   allocations: ${JSON.stringify(data.allocations)}`);
      console.log('');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSchedulesFormat();
