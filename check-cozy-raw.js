const p = require('./public/projects-backup.json');

const projectName = 'Cozy Cabins';

// Find all projects with this name
const matchingProjects = p.filter(proj => proj.projectName === projectName);

console.log(`=== ${projectName} - Complete Data ===\n`);

matchingProjects.forEach((proj, index) => {
  console.log(`\n========== Project ${index + 1} ==========`);
  console.log(JSON.stringify(proj, null, 2));
});
