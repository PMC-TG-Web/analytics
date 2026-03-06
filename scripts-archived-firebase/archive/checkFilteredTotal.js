const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');

const projectMap = new Map();
let filteredOutCount = 0;

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    // Apply all filters
    const isArchived = row.ProjectArchived && row.ProjectArchived.toString().toLowerCase() === 'yes';
    if (isArchived) {
      filteredOutCount++;
      return;
    }
    
    const customer = (row.customer || '').toString().toLowerCase();
    if (customer.includes('sop inc')) {
      filteredOutCount++;
      return;
    }
    
    const projectName = (row.projectName || '').toString().toLowerCase();
    if (projectName === 'pmc operations' || projectName === 'pmc shop time' || projectName === 'pmc test project') {
      filteredOutCount++;
      return;
    }
    
    const estimator = (row.estimator || '').toString().trim();
    if (!estimator) {
      filteredOutCount++;
      return;
    }
    
    if (estimator.toLowerCase() === 'todd gilmore') {
      filteredOutCount++;
      return;
    }
    
    // Group by projectNumber + customer
    const projectKey = `${row.projectNumber || ''}|${row.customer || ''}`;
    
    if (!projectMap.has(projectKey)) {
      projectMap.set(projectKey, { sales: 0, cost: 0, hours: 0, rows: 0 });
    }
    
    const project = projectMap.get(projectKey);
    
    // Parse sales
    const salesStr = row.sales || '';
    const cleanedSales = salesStr.replace(/[\$," ]/g, '');
    if (cleanedSales && !isNaN(cleanedSales)) {
      project.sales += parseFloat(cleanedSales);
    }
    
    // Parse cost
    const costStr = row.cost || '';
    const cleanedCost = costStr.replace(/[\$," ]/g, '');
    if (cleanedCost && !isNaN(cleanedCost)) {
      project.cost += parseFloat(cleanedCost);
    }
    
    // Parse hours
    const hoursStr = row.hours || '';
    const cleanedHours = hoursStr.replace(/[\$," ]/g, '');
    if (cleanedHours && !isNaN(cleanedHours)) {
      project.hours += parseFloat(cleanedHours);
    }
    
    project.rows++;
  })
  .on('end', () => {
    let totalSales = 0;
    let totalCost = 0;
    let totalHours = 0;
    
    projectMap.forEach((project) => {
      totalSales += project.sales;
      totalCost += project.cost;
      totalHours += project.hours;
    });
    
    console.log('\n=== Filtered Total (Aggregated by Project) ===');
    console.log(`Rows filtered out: ${filteredOutCount}`);
    console.log(`Unique projects: ${projectMap.size}`);
    console.log(`Total Sales: $${totalSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`In millions: $${(totalSales/1000000).toFixed(2)}M`);
    console.log(`Total Cost: $${totalCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Total Hours: ${totalHours.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  });
