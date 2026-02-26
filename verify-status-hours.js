const p = require('./public/projects-backup.json');

const summary = {};
summary.statusGroups = {};

p.forEach(proj => {
  const status = proj.status || 'Unknown';
  if (!summary.statusGroups[status]) {
    summary.statusGroups[status] = {
      sales: 0,
      cost: 0,
      hours: 0,
      count: 0,
      laborByGroup: {}
    };
  }
  
  summary.statusGroups[status].sales += proj.sales || 0;
  summary.statusGroups[status].cost += proj.cost || 0;
  summary.statusGroups[status].hours += proj.hours || 0;
  summary.statusGroups[status].count += 1;
  
  // Aggregate pmcBreakdown
  if (proj.pmcBreakdown && typeof proj.pmcBreakdown === 'object') {
    Object.entries(proj.pmcBreakdown).forEach(([group, h]) => {
      const hours = Number(h) || 0;
      if (hours > 0) {
        summary.statusGroups[status].laborByGroup[group] =
          (summary.statusGroups[status].laborByGroup[group] || 0) + hours;
      }
    });
  }
});

const statuses = ['Bid Submitted', 'In Progress', 'Estimating', 'Accepted', 'Complete'];
statuses.forEach(s => {
  const data = summary.statusGroups[s];
  if (data) {
    const laborGroups = Object.keys(data.laborByGroup || {}).length;
    console.log(`\n=== ${s} ===`);
    console.log(`Labor Groups: ${laborGroups}`);
    console.log(`Total Hours: ${data.hours.toLocaleString()}`);
    
    const groups = Object.entries(data.laborByGroup || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    
    if (groups.length > 0) {
      console.log('Top 3 Groups:');
      groups.forEach(([g, h]) => console.log(`  ${g}: ${Number(h).toLocaleString()} hrs`));
    } else {
      console.log('NO LABOR GROUPS FOUND!');
    }
  }
});
