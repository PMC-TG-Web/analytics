// Check all projects in schedules collection to find Canine Partners
const http = require('http');

const makeRequest = (port) => {
  http.get(`http://localhost:${port}/api/scheduling`, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const schedules = json.data || [];
        
        console.log(`\nTotal projects in schedules collection: ${schedules.length}`);
        
        const canine = schedules.find(p => 
          (p.projectName && p.projectName.toLowerCase().includes('canine')) ||
          (p.projectNumber && p.projectNumber.includes('2508'))
        );
        
        if (canine) {
          console.log('\n✓ Found Canine Partners:');
          console.log(`JobKey: ${canine.jobKey}`);
          console.log(`ProjectName: ${canine.projectName}`);
          console.log(`ProjectNumber: ${canine.projectNumber}`);
          console.log(`TotalHours: ${canine.totalHours}`);
          console.log(`Status: ${canine.status}`);
          console.log(`Allocations:`, canine.allocations);
        } else {
          console.log('\n✗ Canine Partners NOT found in schedules collection');
          console.log('\nSearching for any 2508 projects:');
          const cp2508 = schedules.filter(p => p.projectNumber && p.projectNumber.includes('2508'));
          console.log(`Found ${cp2508.length} projects with 2508:`);
          cp2508.forEach(p => {
            console.log(`  - ${p.projectNumber}: ${p.projectName}`);
          });
          
          console.log('\n📋 First 5 projects in schedules collection:');
          schedules.slice(0, 5).forEach((p, i) => {
            console.log(`  ${i+1}. ${p.projectNumber} - ${p.projectName}`);
          });
        }
      } catch(e) {
        console.error('Error:', e.message);
      }
      process.exit(0);
    });
  }).on('error', (e) => {
    if (port === 3000) {
      makeRequest(3001);
    } else {
      console.error('Connection error:', e.message);
      process.exit(1);
    }
  });
};

makeRequest(3000);
