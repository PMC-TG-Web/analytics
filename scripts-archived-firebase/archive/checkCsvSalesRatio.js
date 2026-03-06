const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction.csv');

let rawTotal = 0;
const salesByMonth = new Map();
const projects = new Map();

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    const status = (row.status || row.Status || '').trim();
    if (status !== 'Bid Submitted') return;

    // KPI Filters
    const projectArchived = (row.ProjectArchived || row.projectArchived || '').toString().toLowerCase() === 'yes';
    if (projectArchived) return;

    const customer = (row.customer || row.Customer || '').toString().toLowerCase();
    if (customer.includes('sop inc')) return;

    const projectName = (row.ProjectName || row.projectName || '').toString().toLowerCase();
    if (projectName === "pmc operations" || projectName === "pmc shop time" || projectName === "pmc test project" || 
        projectName.includes("sandbox") || projectName.includes("raymond king") || 
        projectName === "alexander drive addition latest") return;

    const estimator = (row.estimator || row.Estimator || '').toString().trim();
    if (!estimator || estimator.toLowerCase() === "todd gilmore") return;

    const projectNumber = (row.ProjectNumber || row.projectNumber || '').toString().toLowerCase();
    if (projectNumber === "701 poplar church rd") return;

    const identifier = (row.ProjectNumber || row.projectNumber || row.ProjectName || row.projectName || 'Unknown').trim();
    if (!identifier) return;

    const customerName = (row.customer || row.Customer || 'Unknown').trim();
    const dateStr = (row.Date || row.date || row.DateCreated || row.dateCreated || '').trim();
    const projectDate = new Date(dateStr);
    let monthKey = 'INVALID-DATE';
    if (!isNaN(projectDate.getTime())) {
      monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, '0')}`;
    }

    const salesStr = (row.Sales || row.sales || '0').toString().replace(/[$,]/g, '');
    const sales = parseFloat(salesStr) || 0;

    if (!projects.has(identifier)) {
        projects.set(identifier, new Map());
    }
    const customerMap = projects.get(identifier);
    if (!customerMap.has(customerName)) {
        customerMap.set(customerName, { sales: 0, monthKey });
    }
    const data = customerMap.get(customerName);
    data.sales += sales;
  })
  .on('end', () => {
    console.log(`\n=== Bid Submitted Sales Breakdown (DEDUPED) ===`);
    
    const dedupedSalesByMonth = new Map();
    let totalDedupedSales = 0;

    projects.forEach((customerMap, identifier) => {
      // Pick one customer (like KPI page logic)
      // In KPI page: it picks based on priority status, then most recent, then alphabetical
      const customers = Array.from(customerMap.keys()).sort();
      const chosenCustomer = customers[0]; // Simplification
      const data = customerMap.get(chosenCustomer);
      
      const sales = data.sales;
      const monthKey = data.monthKey;
      
      dedupedSalesByMonth.set(monthKey, (dedupedSalesByMonth.get(monthKey) || 0) + sales);
      totalDedupedSales += sales;
    });

    const sortedMonths = Array.from(dedupedSalesByMonth.keys()).sort();
    sortedMonths.forEach(month => {
      console.log(`${month}: $${dedupedSalesByMonth.get(month).toLocaleString()}`);
    });

    console.log(`\nTotal Deduplicated Sales: $${totalDedupedSales.toLocaleString()}`);
  });
