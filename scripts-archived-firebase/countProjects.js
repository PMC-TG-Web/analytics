const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function countProjects() {
  try {
    console.log('Querying Firestore projects collection...\n');
    
    const snapshot = await getDocs(collection(db, 'projects'));
    console.log(`Total records in database: ${snapshot.size}`);
    
    // Count by status
    const statusCounts = {};
    snapshot.forEach(doc => {
      const status = doc.data().status || 'null';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    console.log('\nRecords by status:');
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

countProjects();
