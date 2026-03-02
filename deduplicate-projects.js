const p = require('./public/projects-backup.json');

// Group projects by projectName
const projectGroups = {};

p.forEach(proj => {
  const name = proj.projectName;
  if (!name) return;
  
  if (!projectGroups[name]) {
    projectGroups[name] = [];
  }
  projectGroups[name].push(proj);
});

// Deduplicate based on the logic
const deduplicatedProjects = [];
let duplicatesRemoved = 0;

Object.entries(projectGroups).forEach(([name, projects]) => {
  if (projects.length === 1) {
    // No duplicates, just add it
    deduplicatedProjects.push(projects[0]);
  } else {
    // Multiple projects with the same name - apply deduplication logic
    duplicatesRemoved += projects.length - 1;
    
    // 1. Filter by status "Accepted" or "In Progress"
    let candidates = projects.filter(p => p.status === 'Accepted' || p.status === 'In Progress');
    
    // If no Accepted/In Progress, use all
    if (candidates.length === 0) {
      candidates = projects;
    }
    
    // 2. Sort by dateUpdated (latest first), then by customer alphabetically
    candidates.sort((a, b) => {
      // First priority: dateUpdated (latest first)
      const dateA = a.dateUpdated ? new Date(a.dateUpdated) : new Date(0);
      const dateB = b.dateUpdated ? new Date(b.dateUpdated) : new Date(0);
      
      if (dateB.getTime() !== dateA.getTime()) {
        return dateB.getTime() - dateA.getTime();
      }
      
      // Second priority: customer alphabetically
      const customerA = a.customer || '';
      const customerB = b.customer || '';
      return customerA.localeCompare(customerB);
    });
    
    // Take the first one after sorting
    deduplicatedProjects.push(candidates[0]);
  }
});

// Calculate hours by status
const statusGroups = {};
let totalHours = 0;
let archivedCount = 0;
let archivedHours = 0;
let noCustomerCount = 0;
let noCustomerHours = 0;

deduplicatedProjects.forEach(proj => {
  // Skip archived projects
  if (proj.projectArchived === true) {
    archivedCount++;
    archivedHours += proj.hours || 0;
    return;
  }
  
  // Skip projects without a customer
  if (!proj.customer) {
    noCustomerCount++;
    noCustomerHours += proj.hours || 0;
    return;
  }
  
  const status = proj.status || 'Unknown';
  if (!statusGroups[status]) {
    statusGroups[status] = { hours: 0, count: 0 };
  }
  statusGroups[status].hours += proj.hours || 0;
  statusGroups[status].count += 1;
  totalHours += proj.hours || 0;
});

console.log('=== DEDUPLICATION SUMMARY ===');
console.log(`Original Projects: ${p.length}`);
console.log(`Deduplicated Projects: ${deduplicatedProjects.length}`);
console.log(`Duplicates Removed: ${duplicatesRemoved}`);

console.log('\n=== HOURS BY STATUS (Deduplicated) ===');
Object.entries(statusGroups)
  .sort((a, b) => b[1].hours - a[1].hours)
  .forEach(([s, d]) => {
    console.log(`  ${s}: ${d.hours.toLocaleString()} hours (${d.count} projects)`);
  });

console.log(`\nTotal Hours: ${totalHours.toLocaleString()}`);
console.log(`Active Projects: ${deduplicatedProjects.length - archivedCount - noCustomerCount}`);
console.log(`Archived: ${archivedCount} (${archivedHours.toLocaleString()} hours)`);
console.log(`No Customer: ${noCustomerCount} (${noCustomerHours.toLocaleString()} hours)`);
