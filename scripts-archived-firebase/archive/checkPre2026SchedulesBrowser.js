// Run this in the browser console on localhost:3000/scheduling
async function checkPre2026Schedules() {
  try {
    // Fetch schedules from API
    const response = await fetch('/api/scheduling');
    const data = await response.json();
    const schedules = data.data || [];

    console.log(`\nTotal schedules found: ${schedules.length}\n`);
    console.log('='.repeat(80));
    console.log('Jobs with "In Progress" status that have 100% hours scheduled before 2026:');
    console.log('='.repeat(80));

    const results = [];

    schedules.forEach(schedule => {
      const status = (schedule.status || '').toLowerCase();
      
      // Check if status is "In Progress"
      if (status !== 'in progress') {
        return;
      }

      // Calculate total allocated percentage
      let totalPercent = 0;
      let pre2026Percent = 0;
      let monthBreakdown = [];

      if (schedule.allocations && Array.isArray(schedule.allocations)) {
        schedule.allocations.forEach(alloc => {
          const percent = Number(alloc.percent || 0);
          totalPercent += percent;

          const month = alloc.month || '';
          monthBreakdown.push({ month, percent });

          // Check if month is before 2026
          if (month.startsWith('2025') || month.startsWith('2024') || 
              (month.split('-')[0] && Number(month.split('-')[0]) < 2026)) {
            pre2026Percent += percent;
          }
        });
      }

      // Check if 100% scheduled and all before 2026
      if (totalPercent >= 99.9 && pre2026Percent >= 99.9) { // Using 99.9 to account for floating point precision
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

    console.log(`\nFound ${results.length} jobs:\n`);

    results.forEach((job, index) => {
      console.log(`${index + 1}. ${job.customer} - ${job.projectName}`);
      console.log(`   Project Number: ${job.projectNumber}`);
      console.log(`   Total Hours: ${job.totalHours}`);
      console.log(`   Total Scheduled: ${job.totalPercent}%`);
      console.log(`   Pre-2026 Scheduled: ${job.pre2026Percent}%`);
      console.log(`   Month Breakdown:`);
      
      // Sort months chronologically
      job.monthBreakdown.sort((a, b) => a.month.localeCompare(b.month));
      
      job.monthBreakdown.forEach(m => {
        if (m.percent > 0) {
          console.log(`     ${m.month}: ${m.percent}%`);
        }
      });
      console.log('');
    });

    console.log('='.repeat(80));
    console.log(`Total: ${results.length} jobs with "In Progress" status have 100% hours scheduled before 2026`);
    console.log('='.repeat(80));

    return results;

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the check
checkPre2026Schedules();
