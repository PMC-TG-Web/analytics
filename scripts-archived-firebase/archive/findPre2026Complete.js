const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findPre2026Complete() {
  try {
    // Fetch all schedules
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    const schedules = schedulesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`\nTotal schedules found: ${schedules.length}\n`);
    console.log('='.repeat(80));
    console.log('"In Progress" jobs with 100% of hours scheduled BEFORE 2026:');
    console.log('='.repeat(80));

    const results = [];

    schedules.forEach(schedule => {
      // Calculate total allocated percentage
      let totalPercent = 0;
      let pre2026Percent = 0;
      let monthBreakdown = [];

      if (schedule.allocations && Array.isArray(schedule.allocations)) {
        schedule.allocations.forEach(alloc => {
          const percent = Number(alloc.percent || 0);
          totalPercent += percent;

          const month = alloc.month || '';
          if (percent > 0) {
            monthBreakdown.push({ month, percent });
          }

          const year = month.split('-')[0];
          const yearNum = Number(year);

          if (yearNum < 2026) {
            pre2026Percent += percent;
          }
        });
      }

      // Check if 100% scheduled and all before 2026
      if (totalPercent >= 99.9 && pre2026Percent >= 99.9) {
        results.push({
          customer: schedule.customer || 'Unknown',
          projectName: schedule.projectName || 'Unnamed',
          projectNumber: schedule.projectNumber || 'N/A',
          totalHours: schedule.totalHours || 0,
          totalPercent: totalPercent.toFixed(1),
          pre2026Percent: pre2026Percent.toFixed(1),
          monthBreakdown
        });
      }
    });

    // Sort by customer name
    results.sort((a, b) => a.customer.localeCompare(b.customer));

    console.log(`\nFound: ${results.length} jobs\n`);

    if (results.length > 0) {
      results.forEach((job, index) => {
        console.log(`${index + 1}. ${job.customer}`);
        console.log(`   Project: ${job.projectName}`);
        console.log(`   Project Number: ${job.projectNumber}`);
        console.log(`   Total Hours: ${job.totalHours.toLocaleString()}`);
        console.log(`   Total Scheduled: ${job.totalPercent}%`);
        console.log(`   Schedule:`);
        
        // Sort months chronologically
        job.monthBreakdown.sort((a, b) => a.month.localeCompare(b.month));
        
        job.monthBreakdown.forEach(m => {
          console.log(`     ${m.month}: ${m.percent}%`);
        });
        console.log('');
      });

      console.log('='.repeat(80));
      console.log(`TOTAL: ${results.length} jobs with "In Progress" status have 100% scheduled before 2026`);
      console.log('='.repeat(80));
    } else {
      console.log('No jobs found matching the criteria.\n');
      console.log('This means all "In Progress" jobs either:');
      console.log('  - Are not yet 100% scheduled, OR');
      console.log('  - Have some hours scheduled in 2026 or later\n');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

findPre2026Complete();
