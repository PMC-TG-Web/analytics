const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function analyzeSchedules() {
  try {
    // Fetch all schedules
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    const schedules = schedulesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`\nTotal schedules found: ${schedules.length}\n`);

    // First, let's see what statuses we have
    const statusCounts = {};
    schedules.forEach(schedule => {
      const status = schedule.status || 'Unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    console.log('Status breakdown:');
    Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('Analysis of "In Progress" jobs:');
    console.log('='.repeat(80));

    const inProgressJobs = [];

    schedules.forEach(schedule => {
      const status = (schedule.status || '').trim();
      
      // Check if status is "In Progress" (case-insensitive)
      if (status.toLowerCase() !== 'in progress') {
        return;
      }

      // Calculate total allocated percentage
      let totalPercent = 0;
      let pre2026Percent = 0;
      let year2026Percent = 0;
      let post2026Percent = 0;
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
          } else if (yearNum === 2026) {
            year2026Percent += percent;
          } else if (yearNum > 2026) {
            post2026Percent += percent;
          }
        });
      }

      inProgressJobs.push({
        customer: schedule.customer || 'Unknown',
        projectName: schedule.projectName || 'Unnamed',
        projectNumber: schedule.projectNumber || 'N/A',
        totalHours: schedule.totalHours || 0,
        totalPercent: totalPercent.toFixed(1),
        pre2026Percent: pre2026Percent.toFixed(1),
        year2026Percent: year2026Percent.toFixed(1),
        post2026Percent: post2026Percent.toFixed(1),
        monthBreakdown
      });
    });

    console.log(`\nTotal "In Progress" jobs: ${inProgressJobs.length}\n`);

    // Sort by customer name
    inProgressJobs.sort((a, b) => a.customer.localeCompare(b.customer));

    // Show jobs that are 100% scheduled before 2026
    const fullyPre2026 = inProgressJobs.filter(job => 
      Number(job.totalPercent) >= 99.9 && Number(job.pre2026Percent) >= 99.9
    );

    console.log(`Jobs with 100% scheduled before 2026: ${fullyPre2026.length}`);
    if (fullyPre2026.length > 0) {
      fullyPre2026.forEach((job, index) => {
        console.log(`\n${index + 1}. ${job.customer} - ${job.projectName}`);
        console.log(`   Total Hours: ${job.totalHours}`);
        console.log(`   Pre-2026: ${job.pre2026Percent}%`);
      });
    }

    // Show all "In Progress" jobs with their year distribution
    console.log('\n' + '='.repeat(80));
    console.log('All "In Progress" jobs with scheduling breakdown:');
    console.log('='.repeat(80));

    inProgressJobs.forEach((job, index) => {
      console.log(`\n${index + 1}. ${job.customer} - ${job.projectName}`);
      console.log(`   Project Number: ${job.projectNumber}`);
      console.log(`   Total Hours: ${job.totalHours}`);
      console.log(`   Total Scheduled: ${job.totalPercent}%`);
      console.log(`   Year Distribution:`);
      console.log(`     Before 2026: ${job.pre2026Percent}%`);
      console.log(`     2026: ${job.year2026Percent}%`);
      console.log(`     After 2026: ${job.post2026Percent}%`);
      
      if (job.monthBreakdown.length > 0) {
        console.log(`   Month Breakdown:`);
        job.monthBreakdown.sort((a, b) => a.month.localeCompare(b.month));
        job.monthBreakdown.forEach(m => {
          console.log(`     ${m.month}: ${m.percent}%`);
        });
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

analyzeSchedules();
