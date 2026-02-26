const mock = require('./src/lib/mockFirestore.ts');

// This is a test - it'll show what goes to the dashboard
mock.default.getDashboardSummary().then(summary => {
  if (summary && summary.statusGroups) {
    const statuses = ['Bid Submitted', 'In Progress', 'Estimating'];
    statuses.forEach(status => {
      const group = summary.statusGroups[status];
      if (group) {
        console.log(`\n${status}:`);
        console.log(`  Total Hours: ${group.hours}`);
        console.log(`  Labor Groups: ${Object.keys(group.laborByGroup || {}).length}`);
        console.log(`  Sample Groups:`, Object.entries(group.laborByGroup || {}).slice(0, 2));
      }
    });
  }
});
