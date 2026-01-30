const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');

let totalSales = 0;
let totalCost = 0;
let totalHours = 0;
let rowCount = 0;

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
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
    console.log('\n=== CSV Total (All Rows) ===');
    console.log(`Total rows processed: ${rowCount}`);
    console.log(`Total Sales: $${totalSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`In millions: $${(totalSales/1000000).toFixed(2)}M`);
    console.log(`Total Cost: $${totalCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Total Hours: ${totalHours.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  });
