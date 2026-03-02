const p = require('./public/projects-backup.json');

const statusGroups = {};
let totalHours = 0;
const jobKeys = new Set();
let duplicates = 0;
let archivedCount = 0;
let archivedHours = 0;
let noCustomerCount = 0;
let noCustomerHours = 0;

p.forEach(proj => {
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
  
  if (jobKeys.has(proj.jobKey)) {
    duplicates++;
  } else {
    jobKeys.add(proj.jobKey);
  }
});

console.log('All Statuses:');
Object.entries(statusGroups)
  .sort((a, b) => b[1].hours - a[1].hours)
  .forEach(([s, d]) => {
    console.log(`  ${s}: ${d.hours.toLocaleString()} hours (${d.count} projects)`);
  });

console.log(`\nTotal Hours (excluding archived & no customer): ${totalHours.toLocaleString()}`);
console.log(`Total Active Projects: ${p.length - archivedCount - noCustomerCount}`);
console.log(`Archived Projects: ${archivedCount} (${archivedHours.toLocaleString()} hours)`);
console.log(`No Customer: ${noCustomerCount} (${noCustomerHours.toLocaleString()} hours)`);
console.log(`Unique Job Keys: ${jobKeys.size}`);
console.log(`Duplicate entries: ${duplicates}`);
