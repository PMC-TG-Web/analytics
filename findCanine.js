const http = require('http');

const makeRequest = (port) => {
  http.get(`http://localhost:${port}/api/scheduling`, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const projects = json.schedules || [];
      const canine = projects.find(p => p.projectName && p.projectName.toLowerCase().includes('canine'));
      
      if (canine) {
        console.log('✓ Canine Partners found:');
        console.log(JSON.stringify(canine, null, 2));
      } else {
        console.log('✗ Canine Partners NOT found');
        console.log('Total projects:', projects.length);
        console.log('\nFirst 10 projects:');
        projects.slice(0, 10).forEach(p => {
          console.log('  -', p.projectName);
        });
      }
    } catch(e) {
      console.error('Error parsing response:', e.message);
      console.log('Response:', data.substring(0, 500));
    }
    process.exit(0);
  });
}).on('error', (e) => {
  if (port === 3000) {
    console.log('Port 3000 not available, trying 3001...');
    makeRequest(3001);
  } else {
    console.error('Connection error:', e.message);
    console.log('\nNote: Make sure the Next.js dev server is running (npm run dev)');
    process.exit(1);
  }
});
};

makeRequest(3000);
