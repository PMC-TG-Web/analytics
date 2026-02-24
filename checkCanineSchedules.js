// Debug script to check Canine Partners in schedules collection
const http = require('http');

const makeRequest = (port) => {
  http.get(`http://localhost:${port}/api/scheduling?jobKey=2508_CP`, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log('\n✓ Scheduling API Response:');
        console.log(JSON.stringify(json.data, null, 2));
        
        if (json.data) {
          const project = json.data;
          console.log('\n📊 Canine Partners Details:');
          console.log(`JobKey: ${project.jobKey}`);
          console.log(`Project: ${project.projectName}`);
          console.log(`Total Hours: ${project.totalHours}`);
          console.log(`Allocations:`, project.allocations);
          
          if (project.allocations) {
            console.log('\n📅 Months for Allocations:');
            Object.keys(project.allocations).forEach(month => {
              const percent = project.allocations[month];
              console.log(`  ${month}: ${percent}%`);
            });
          }
        }
      } catch(e) {
        console.error('Error parsing response:', e.message);
        console.log('Response:', data.substring(0, 500));
      }
      process.exit(0);
    });
  }).on('error', (e) => {
    if (port === 3000) {
      makeRequest(3001);
    } else {
      console.error('Connection error:', e.message);
      console.log('\nMake sure Next.js dev server is running (npm run dev)');
      process.exit(1);
    }
  });
};

console.log('Checking Canine Partners in schedules collection...');
console.log(`Today is: ${new Date().toLocaleDateString()}`);
console.log(`5-week window starts: Monday of current week`);

makeRequest(3000);
