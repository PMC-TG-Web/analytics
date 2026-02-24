// Search specifically for Canine Partners
const http = require('http');

const makeRequest = (port) => {
  http.get(`http://localhost:${port}/api/scheduling`, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const schedules = json.data || [];
        
        console.log(`Total schedules: ${schedules.length}\n`);
        
        // Search for anything with Canine
        const canineProjects = schedules.filter(p => 
          (p.projectName && p.projectName.toLowerCase().includes('canine')) ||
          (p.customer && p.customer.toLowerCase().includes('canine'))
        );
        
        if (canineProjects.length > 0) {
          console.log('✓ Found Canine projects:');
          canineProjects.forEach(p => {
            console.log(`\n  JobKey: ${p.jobKey}`);
            console.log(`  ProjectName: ${p.projectName}`);
            console.log(`  ProjectNumber: ${p.projectNumber}`);
            console.log(`  TotalHours: ${p.totalHours}`);
            console.log(`  Allocations:`, p.allocations);
          });
        } else {
          console.log('✗ No projects with "Canine" found\n');
          console.log('Listing ALL projects in schedules collection:');
          schedules.forEach(p => {
            console.log(`  ${p.projectNumber}: ${p.projectName}`);
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
