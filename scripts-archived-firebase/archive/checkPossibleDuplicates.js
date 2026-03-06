const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction.csv');

const projects = [];

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    const status = (row.status || row.Status || '').trim();
    if (status !== 'Bid Submitted') return;

    // Filters
    const projectArchived = (row.ProjectArchived || row.projectArchived || '').toString().toLowerCase() === 'yes';
    if (projectArchived) return;

    const projectName = (row.ProjectName || row.projectName || '').trim();
    const customer = (row.customer || row.Customer || '').trim();
    const sales = parseFloat((row.Sales || row.sales || '0').toString().replace(/[$,]/g, '')) || 0;
    const dateStr = (row.Date || row.date || row.DateCreated || row.dateCreated || '').trim();
    const projectNumber = (row.ProjectNumber || row.projectNumber || '').trim();

    projects.push({ projectName, customer, sales, dateStr, projectNumber });
  })
  .on('end', () => {
    // Group by identifier
    const grouped = new Map();
    projects.forEach(p => {
      const id = (p.projectNumber || p.projectName).toLowerCase().trim();
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(p);
    });

    console.log('--- Potential Duplicate Issues (Same Name, Different Rows) ---');
    grouped.forEach((list, id) => {
       const customers = new Set(list.map(l => l.customer));
       if (customers.size > 1) {
         const total = list.reduce((sum, curr) => sum + curr.sales, 0);
         // This is how KPI logic works: it picks ONE customer and sums all rows for that customer.
         // Wait, let's see if there are DIFFERENT project names that are almost the same.
       }
    });

    // Let's just list the largest projects and see if anything looks fishy.
    const projectTotals = new Map();
    projects.forEach(p => {
        const id = (p.projectNumber || p.projectName).trim();
        if (!projectTotals.has(id)) projectTotals.set(id, { sales: 0, customers: new Set() });
        projectTotals.get(id).sales += p.sales;
        projectTotals.get(id).customers.add(p.customer);
    });

    const sorted = Array.from(projectTotals.entries()).sort((a, b) => b[1].sales - a[1].sales);
    
    console.log('\n--- Largest Bid Submitted Projects (Deduped by Name/Number) ---');
    sorted.slice(0, 20).forEach(([id, data]) => {
        console.log(`${id}: $${data.sales.toLocaleString()} (${data.customers.size} customers)`);
    });
  });
