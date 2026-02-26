/**
 * verifyKemperActiveSchedule.js
 * 
 * Verify activeSchedule and scopeTracking data for Kemper
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const KEMPER_JOB_KEY = "Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment";

async function verifyKemper() {
  console.log('\n🔍 Verifying Kemper data in activeSchedule and scopeTracking\n');
  
  // Check activeSchedule
  console.log('📅 activeSchedule entries:');
  const activeScheduleSnapshot = await getDocs(
    query(collection(db, 'activeSchedule'), where('jobKey', '==', KEMPER_JOB_KEY))
  );
  
  if (activeScheduleSnapshot.empty) {
    console.log('   ❌ No entries found!\n');
  } else {
    const entriesByDate = {};
    activeScheduleSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (!entriesByDate[data.date]) {
        entriesByDate[data.date] = [];
      }
      entriesByDate[data.date].push(data);
    });
    
    Object.entries(entriesByDate).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, entries]) => {
      const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
      console.log(`\n   📆 ${date} (${totalHours} total hours):`);
      entries.forEach(entry => {
        console.log(`      - ${entry.scopeOfWork}: ${entry.hours} hrs (source: ${entry.source})`);
      });
    });
    console.log('');
  }
  
  // Check scopeTracking
  console.log('📊 scopeTracking entries:');
  const scopeTrackingSnapshot = await getDocs(
    query(collection(db, 'scopeTracking'), where('jobKey', '==', KEMPER_JOB_KEY))
  );
  
  if (scopeTrackingSnapshot.empty) {
    console.log('   ❌ No entries found!\n');
  } else {
    let totalScheduled = 0;
    let totalUnscheduled = 0;
    
    console.log('');
    scopeTrackingSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log(`   📋 ${data.scopeOfWork}`);
      console.log(`      Total: ${data.totalHours} hrs`);
      console.log(`      Scheduled: ${data.scheduledHours} hrs`);
      console.log(`      Unscheduled: ${data.unscheduledHours} hrs`);
      console.log('');
      
      totalScheduled += data.scheduledHours;
      totalUnscheduled += data.unscheduledHours;
    });
    
    console.log(`   Summary:`);
    console.log(`      Total Scheduled: ${totalScheduled} hrs`);
    console.log(`      Total Unscheduled: ${totalUnscheduled} hrs`);
    console.log(`      Grand Total: ${totalScheduled + totalUnscheduled} hrs\n`);
  }
}

verifyKemper()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
