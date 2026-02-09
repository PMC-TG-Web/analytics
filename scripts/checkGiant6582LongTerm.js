const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function check() {
  try {
    const snapshot = await getDocs(collection(db, 'long term schedual'));
    
    console.log(`Total documents in "long term schedual": ${snapshot.size}\n`);
    
    // Find all Giant #6582 entries
    const giant = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectName?.includes('Giant #6582')) {
        giant.push({
          docId: doc.id,
          jobKey: data.jobKey,
          projectName: data.projectName,
          customer: data.customer,
          projectNumber: data.projectNumber,
          totalHours: data.totalHours,
          month: data.month,
        });
      }
    });
    
    console.log(`Found ${giant.length} "Giant #6582" documents in long term schedual:\n`);
    giant.forEach(g => {
      console.log(`  Doc ID: ${g.docId}`);
      console.log(`  JobKey: ${g.jobKey}`);
      console.log(`  Customer: ${g.customer}`);
      console.log(`  Month: ${g.month}`);
      console.log(`  Total Hours: ${g.totalHours}\n`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

check();
