const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

// Load Firebase config
const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkData() {
  try {
    console.log('Checking Firestore collections...');
    
    // Check projects
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    console.log(`\nProjects collection: ${projectsSnapshot.docs.length} documents`);
    if (projectsSnapshot.docs.length > 0) {
      const sample = projectsSnapshot.docs[0].data();
      console.log('Sample project fields:', Object.keys(sample));
      console.log('Sample project:', {
        customer: sample.customer,
        projectNumber: sample.projectNumber,
        projectName: sample.projectName,
        status: sample.status,
        sales: sample.sales,
        hours: sample.hours
      });
    }
    
    // Check schedules
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    console.log(`\nSchedules collection: ${schedulesSnapshot.docs.length} documents`);
    if (schedulesSnapshot.docs.length > 0) {
      const sample = schedulesSnapshot.docs[0].data();
      console.log('Sample schedule fields:', Object.keys(sample));
      console.log('Sample schedule:', {
        jobKey: sample.jobKey,
        customer: sample.customer,
        projectNumber: sample.projectNumber,
        projectName: sample.projectName,
        totalHours: sample.totalHours,
        allocationsCount: sample.allocations?.length
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkData();
