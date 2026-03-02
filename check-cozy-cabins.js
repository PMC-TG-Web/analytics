const p = require('./public/projects-backup.json');

const projectName = 'Cozy Cabins';

// Find all projects with this name
const matchingProjects = p.filter(proj => proj.projectName === projectName);

console.log(`=== ${projectName} ===`);
console.log(`Found ${matchingProjects.length} projects with this name:\n`);

matchingProjects.forEach((proj, index) => {
  console.log(`Project ${index + 1}:`);
  console.log(`  Customer: ${proj.customer}`);
  console.log(`  Status: ${proj.status}`);
  console.log(`  Hours: ${proj.hours}`);
  console.log(`  Date Updated: ${JSON.stringify(proj.dateUpdated)}`);
  console.log(`  Date Created: ${JSON.stringify(proj.dateCreated)}`);
  
  // Show all date-related fields
  Object.keys(proj).forEach(key => {
    if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time')) {
      console.log(`  ${key}: ${JSON.stringify(proj[key])}`);
    }
  });
  console.log('');
});
