const p = require('./public/projects-backup.json');

const projectName = 'ACTS Lower Gwynedd - Oakbridge Terrace';

// Find all projects with this name
const matchingProjects = p.filter(proj => proj.projectName === projectName);

console.log(`=== ${projectName} ===`);
console.log(`Found ${matchingProjects.length} projects with this name:\n`);

matchingProjects.forEach((proj, index) => {
  console.log(`Project ${index + 1}:`);
  console.log(`  Customer: ${proj.customer}`);
  console.log(`  Status: ${proj.status}`);
  console.log(`  Hours: ${proj.hours}`);
  console.log(`  Date Updated: ${proj.dateUpdated || 'N/A'}`);
  console.log(`  Date Created: ${proj.dateCreated || 'N/A'}`);
  console.log('');
});

// Apply the deduplication logic
let candidates = matchingProjects.filter(p => p.status === 'Accepted' || p.status === 'In Progress');

if (candidates.length === 0) {
  candidates = matchingProjects;
  console.log('No Accepted/In Progress status found, using all projects.\n');
} else {
  console.log(`Filtered to ${candidates.length} with Accepted/In Progress status.\n`);
}

// Sort by dateUpdated (latest first), then by customer alphabetically
candidates.sort((a, b) => {
  const dateA = a.dateUpdated ? new Date(a.dateUpdated) : new Date(0);
  const dateB = b.dateUpdated ? new Date(b.dateUpdated) : new Date(0);
  
  if (dateB.getTime() !== dateA.getTime()) {
    return dateB.getTime() - dateA.getTime();
  }
  
  const customerA = a.customer || '';
  const customerB = b.customer || '';
  return customerA.localeCompare(customerB);
});

console.log('=== CHOSEN PROJECT ===');
const chosen = candidates[0];
console.log(`Customer: ${chosen.customer}`);
console.log(`Status: ${chosen.status}`);
console.log(`Hours: ${chosen.hours}`);
console.log(`Date Updated: ${chosen.dateUpdated || 'N/A'}`);
