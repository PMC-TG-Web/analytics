const projectId = '9cde4d43a1f9a5ae2b50a4a8'; // Westminster

console.log('Fetching debug info from API...\n');

try {
  const response = await fetch(`http://localhost:3000/api/gantt-v2/debug-sync?projectId=${projectId}`);
  console.log('Response status:', response.status);
  
  const data = await response.json();
  console.log('Raw response:', JSON.stringify(data, null, 2));
  
  console.log('\n=== DEBUG SYNC RESULTS ===\n');
  console.log('Project:', data.project?.project_name);
  console.log('Project Number:', data.project?.project_number);
  console.log('Scopes Found:', data.scopeCount);
  console.log('\n=== SEARCH RESULTS ===');
  
  if (data.searches?.byProjectNumber) {
    console.log('\nBy Project Number ("' + data.searches.byProjectNumber.searchTerm + '"):');
    console.log('  Found:', data.searches.byProjectNumber.found);
    console.log('  JobKeys:', data.searches.byProjectNumber.jobKeys);
  }
  
  if (data.searches?.byProjectName) {
    console.log('\nBy Project Name ("' + data.searches.byProjectName.searchTerm + '"):');
    console.log('  Found:', data.searches.byProjectName.found);
    console.log('  JobKeys:', data.searches.byProjectName.jobKeys);
  }
  
  console.log('\n=== WESTMINSTER CHECK ===');
  console.log('Found:', data.westminsterCheck?.found);
  console.log('Entries:', JSON.stringify(data.westminsterCheck?.entries, null, 2));
  
  console.log('\n=== ALL JOB KEYS IN DATABASE ===');
  console.log('Total:', data.totalJobKeys);
  console.log('JobKeys:', data.allJobKeys);
  
  process.exit(0);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
