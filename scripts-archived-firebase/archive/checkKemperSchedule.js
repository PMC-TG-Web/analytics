const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkKemperSchedule() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  const jobKey = "Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment";
  
  console.log('\nSearching schedules collection for Kemper Equipment...\n');
  
  const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
  
  const kemperSchedules = schedulesSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(s => s.jobKey === jobKey || 
                 (s.projectName && s.projectName.includes('Kemper')) ||
                 (s.projectNumber === '2505 - KE'));
  
  if (kemperSchedules.length === 0) {
    console.log('❌ No schedules found for Kemper Equipment');
    console.log('\nChecking all schedules with "Hoover Building Specialists"...\n');
    
    const hooverSchedules = schedulesSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(s => s.customer && s.customer.includes('Hoover'));
    
    console.log(`Found ${hooverSchedules.length} Hoover projects:\n`);
    hooverSchedules.forEach(s => {
      console.log(`- ${s.projectName || 'Unnamed'} (${s.projectNumber || 'No number'})`);
      console.log(`  JobKey: ${s.jobKey}`);
    });
  } else {
    console.log(`✓ Found ${kemperSchedules.length} schedule(s):\n`);
    
    kemperSchedules.forEach(schedule => {
      console.log('JobKey:', schedule.jobKey);
      console.log('Project:', schedule.projectName);
      console.log('Total Hours:', schedule.totalHours);
      console.log('\nMonth Allocations:');
      
      if (schedule.allocations) {
        const sorted = Object.entries(schedule.allocations)
          .sort(([a], [b]) => a.localeCompare(b))
          .filter(([month, pct]) => pct > 0);
        
        sorted.forEach(([month, percent]) => {
          const hours = (schedule.totalHours * percent / 100).toFixed(1);
          console.log(`  ${month}: ${percent}% (${hours} hours)`);
        });
      } else {
        console.log('  No allocations found');
      }
    });
  }
}

checkKemperSchedule()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
