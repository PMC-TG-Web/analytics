const response = await fetch('http://localhost:3000/api/scheduling?pageSize=500');
const data = await response.json();

// Find Giant #6582
const giantSchedule = data.data.find(s => s.projectName?.includes('Giant'));

if (giantSchedule) {
  console.log('API Response for Giant #6582:');
  console.log(JSON.stringify(giantSchedule, null, 2));
  
  console.log('\nFrontend transformation:');
  // Simulate the frontend transformation
  let allocations = {};
  if (giantSchedule.allocations) {
    if (Array.isArray(giantSchedule.allocations)) {
      allocations = giantSchedule.allocations.reduce((acc, alloc) => {
        acc[alloc.month] = alloc.percent;  
        return acc;
      }, {});
    } else {
      allocations = giantSchedule.allocations;
    }
  }
  
  console.log('Converted allocations object:');
  console.log(JSON.stringify(allocations, null, 2));
  
  // Simulate the row calculation for totalHours
  console.log('\nRow calculation (like line 1140):');
  const totalPercent = Object.values(allocations).reduce((sum, percent) => sum + percent, 0);
  console.log(`Sum of allocation percents: ${totalPercent}%`);
  console.log(`totalHours * (totalPercent/100) = ${giantSchedule.totalHours} * (${totalPercent}/100) = ${giantSchedule.totalHours * totalPercent / 100}`);
  
  // Simulate monthly calculation
  console.log('\nMonthly calculation (like line 927):');
  Object.entries(allocations).forEach(([month, percent]) => {
    const monthlyHours = giantSchedule.totalHours * (percent / 100);
    console.log(`  ${month}: ${giantSchedule.totalHours} * (${percent}/100) = ${monthlyHours}h`);
  });
} else {
  console.log('Giant schedule not found in API response');
  console.log('All schedules:', data.data.map(s => s.projectName));
}
