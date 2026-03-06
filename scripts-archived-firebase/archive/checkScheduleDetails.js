const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkScheduleDetails() {
  try {
    console.log('\n========================================');
    console.log('Schedule Details - Status & Allocations');
    console.log('========================================\n');

    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    
    let inProgressCount = 0;
    let withAllocations = 0;
    let newProjects = [];
    
    schedulesSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      
      // Check new projects we added
      if (['CHN Site/GSC', 'Hoover/Brecknock Orchards', 'JE Horst/Jono Hardware', 'JE Horst/Jubilee Ministries'].includes(data.projectName)) {
        newProjects.push({
          projectName: data.projectName,
          status: data.status,
          totalHours: data.totalHours,
          allocations: data.allocations,
          jobKey: data.jobKey
        });
      }
      
      if (data.status === 'In Progress') {
        inProgressCount++;
      }
      
      const allocs = data.allocations;
      const hasAllocations = allocs && (
        (Array.isArray(allocs) && allocs.length > 0) || 
        (typeof allocs === 'object' && Object.keys(allocs).length > 0)
      );
      
      if (hasAllocations) {
        withAllocations++;
      }
    });
    
    console.log(`Total schedules: ${schedulesSnapshot.docs.length}`);
    console.log(`In Progress: ${inProgressCount}`);
    console.log(`With allocations: ${withAllocations}\n`);
    
    console.log('New Projects Status:');
    newProjects.forEach(p => {
      console.log(`\n${p.projectName}:`);
      console.log(`  Status: ${p.status}`);
      console.log(`  Total Hours: ${p.totalHours}`);
      console.log(`  JobKey: ${p.jobKey}`);
      console.log(`  Allocations: ${JSON.stringify(p.allocations)}`);
    });
    
    console.log('\n========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkScheduleDetails();
