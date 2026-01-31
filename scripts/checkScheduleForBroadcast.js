const admin = require('firebase-admin');
const serviceAccount = require('../src/firebaseConfig.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkSchedules() {
  try {
    const snapshot = await db.collection('schedules').get();
    console.log(`\nTotal schedules in collection: ${snapshot.size}\n`);
    
    const broadcasts = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectName && data.projectName.toLowerCase().includes('broadcast')) {
        broadcasts.push({
          id: doc.id,
          jobKey: data.jobKey,
          projectName: data.projectName,
          customer: data.customer,
          status: data.status,
          totalHours: data.totalHours
        });
      }
    });
    
    if (broadcasts.length > 0) {
      console.log(`Found ${broadcasts.length} schedule(s) with "broadcast" in name:\n`);
      broadcasts.forEach(s => {
        console.log(`  Project: ${s.projectName}`);
        console.log(`  Customer: ${s.customer}`);
        console.log(`  Job Key: ${s.jobKey}`);
        console.log(`  Status: ${s.status}`);
        console.log(`  Total Hours: ${s.totalHours}`);
        console.log('');
      });
    } else {
      console.log('No schedules found with "broadcast" in the name');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSchedules();
