const fetch = require('node-fetch');

async function checkSchedulesForInProgress() {
  try {
    const schedulesRes = await fetch('http://localhost:3000/api/scheduling');
    const schedulesJson = await schedulesRes.json();
    const schedules = schedulesJson.schedules || [];
    
    console.log('\n========== SCHEDULES INFO ==========');
    console.log(`Total schedules: ${schedules.length}`);
    
    if (schedules.length > 0) {
      console.log(`\nFirst 5 schedules:`);
      schedules.slice(0, 5).forEach((s, i) => {
        console.log(`\n${i+1}. ${s.customer || 'N/A'} | ${s.projectNumber || 'N/A'} | ${s.projectName || 'N/A'}`);
        console.log(`   Status: ${s.status || 'N/A'}`);
        console.log(`   Allocations: ${s.allocations?.length || 0}`);
        if (s.allocations && s.allocations.length > 0) {
          console.log(`   Months: ${s.allocations.map(a => a.month).join(', ')}`);
        }
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkSchedulesForInProgress();
