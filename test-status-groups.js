const p = require('./public/projects-backup.json');

const filtered = p.filter(proj => proj.status && !['Invitations', 'To Do', 'Unknown'].includes(proj.status));
const groups = {};

filtered.forEach(proj => {
  const status = proj.status;
  if (!groups[status]) groups[status] = {hours: 0, count: 0, laborByGroup: {}};
  groups[status].hours += proj.hours || 0;
  groups[status].count += 1;
  
  if (proj.pmcBreakdown) {
    Object.entries(proj.pmcBreakdown).forEach(([group, hours]) => {
      const h = Number(hours) || 0;
      if (h > 0) {
        groups[status].laborByGroup[group] = (groups[status].laborByGroup[group] || 0) + h;
      }
    });
  }
});

Object.entries(groups).forEach(([status, data]) => {
  console.log(`\n=== Status: ${status} ===`);
  console.log(`Total Hours: ${data.hours.toLocaleString()}, Count: ${data.count}`);
  console.log('Top 5 Labor Groups:');
  Object.entries(data.laborByGroup)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([group, h]) => console.log(`  ${group}: ${Number(h).toLocaleString()} hrs`));
});
