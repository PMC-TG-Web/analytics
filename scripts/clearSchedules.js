const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function clearSchedules() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    console.log('Fetching all schedules...');
    const querySnapshot = await getDocs(collection(db, 'schedules'));
    
    console.log(`Found ${querySnapshot.size} schedule documents`);
    
    if (querySnapshot.size === 0) {
      console.log('No schedules to delete.');
      process.exit(0);
    }

    console.log('Deleting schedules...');
    let count = 0;
    
    for (const doc of querySnapshot.docs) {
      await deleteDoc(doc.ref);
      count++;
      if (count % 10 === 0) {
        console.log(`Deleted ${count} schedules...`);
      }
    }

    console.log(`\n✅ Successfully deleted ${count} schedules from Firestore`);
    console.log('The scheduling page will now show only filtered projects without saved allocations.');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

clearSchedules();
