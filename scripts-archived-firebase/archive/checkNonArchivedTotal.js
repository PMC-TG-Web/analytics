const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');

let totalSales = 0;
let totalCost = 0;
let totalHours = 0;
let rowCount = 0;
let archivedCount = 0;

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    // Check if archived
    const isArchived = row.ProjectArchived && row.ProjectArchived.toString().toLowerCase() === 'yes';
    
    if (isArchived) {
      archivedCount++;
      return; // Skip archived projects
    }
    
    rowCount++;
    
    // Parse sales
    const salesStr = row.sales || '';
    const cleanedSales = salesStr.replace(/[\$," ]/g, '');
    if (cleanedSales && !isNaN(cleanedSales)) {
      totalSales += parseFloat(cleanedSales);
    }
    
    // Parse cost
    const costStr = row.cost || '';
    const cleanedCost = costStr.replace(/[\$," ]/g, '');
    if (cleanedCost && !isNaN(cleanedCost)) {
      totalCost += parseFloat(cleanedCost);
    }
    
    // Parse hours
    const hoursStr = row.hours || '';
    const cleanedHours = hoursStr.replace(/[\$," ]/g, '');
    if (cleanedHours && !isNaN(cleanedHours)) {
      totalHours += parseFloat(cleanedHours);
    }
  })
  .on('end', () => {
    console.log('\n=== CSV Total (Non-Archived Only) ===');
    console.log(`Archived rows excluded: ${archivedCount}`);
    console.log(`Non-archived rows processed: ${rowCount}`);
    console.log(`Total Sales: $${totalSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`In millions: $${(totalSales/1000000).toFixed(2)}M`);
    console.log(`Total Cost: $${totalCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Total Hours: ${totalHours.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  });
