const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction.csv');

let rawTotal = 0;
let rowCount = 0;
let bidSubmittedRows = 0;

const projects = new Map();

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    rowCount++;
    const status = (row.status || row.Status || '').trim();
    if (status === 'Bid Submitted') {
      // Apply filters from KPI page
      const projectArchived = (row.ProjectArchived || row.projectArchived || '').toString().toLowerCase() === 'yes';
      if (projectArchived) return;

      const customer = (row.customer || row.Customer || '').toString().toLowerCase();
      if (customer.includes('sop inc')) return;

      const projectName = (row.ProjectName || row.projectName || '').toString().toLowerCase();
      if (projectName === "pmc operations") return;
      if (projectName === "pmc shop time") return;
      if (projectName === "pmc test project") return;
      if (projectName.includes("sandbox")) return;
      if (projectName.includes("raymond king")) return;
      if (projectName === "alexander drive addition latest") return;

      const estimator = (row.estimator || row.Estimator || '').toString().trim();
      if (!estimator) return;
      if (estimator.toLowerCase() === "todd gilmore") return;

      const projectNumber = (row.ProjectNumber || row.projectNumber || '').toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return;

      bidSubmittedRows++;
      const salesStr = (row.Sales || row.sales || '0').toString().replace(/[$,]/g, '');
      const sales = parseFloat(salesStr) || 0;
      rawTotal += sales;

      const identifier = (row.ProjectNumber || row.projectNumber || row.ProjectName || row.projectName || 'Unknown').trim();
      const customerName = (row.customer || row.Customer || 'Unknown').trim();
      const key = `${identifier}|${customerName}`;
      
      if (!projects.has(key)) {
        projects.set(key, 0);
      }
      projects.set(key, projects.get(key) + sales);
    }
  })
  .on('end', () => {
    console.log(`Total rows processed: ${rowCount}`);
    console.log(`Total 'Bid Submitted' rows: ${bidSubmittedRows}`);
    console.log(`Raw Total Sales (Sum of all rows): $${rawTotal.toLocaleString()}`);
    
    // Deduplication by Project (Identifier) - matching KPI logic
    const uniqueProjects = new Map();
    // In KPI page: dedupedByCustomer logic picks one customer per project identifier
    // Then it sums sales for that customer's entries.
    
    // Let's first group by identifier
    const identifierMap = new Map();
    projects.forEach((sales, key) => {
      const [id, cust] = key.split('|');
      if (!identifierMap.has(id)) {
        identifierMap.set(id, new Map());
      }
      identifierMap.get(id).set(cust, sales);
    });

    let dedupedTotal = 0;
    identifierMap.forEach((custMap, id) => {
      // Pick the first customer (simplification for now)
      const firstCust = Array.from(custMap.keys())[0];
      const sales = custMap.get(firstCust);
      dedupedTotal += sales;
    });

    console.log(`Deduplicated Total (One customer per project): $${dedupedTotal.toLocaleString()}`);
    
    // Let's check for specific high-value duplicates
    console.log('\nTop 5 Projects by Sales:');
    const sorted = Array.from(projects.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
    sorted.forEach(([key, val]) => {
        console.log(`- ${key}: $${val.toLocaleString()}`);
    });
  });
