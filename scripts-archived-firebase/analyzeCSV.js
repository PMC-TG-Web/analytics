const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n');
const headers = lines[0].split(',').map(h => h.trim());

console.log('Headers:', headers);
console.log('\nFirst few data rows:');

// Parse CSV properly
const rows = [];
for (let i = 1; i < Math.min(10, lines.length); i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  const cols = line.split(',');
  const row = {};
  headers.forEach((h, idx) => {
    row[h] = cols[idx] || '';
  });
  rows.push(row);
  console.log(`Row ${i}:`);
  console.log(`  projectNumber: ${row.projectNumber}`);
  console.log(`  sales: ${row.sales}`);
  console.log(`  projectName: ${row.projectName}`);
}

// Now calculate totals grouping by projectNumber + projectName
const projectMap = new Map();
let totalRawSales = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  const cols = line.split(',');
  const row = {};
  headers.forEach((h, idx) => {
    row[h] = cols[idx] ? cols[idx].trim() : '';
  });
  
  const salesStr = row.sales || '';
  const cleaned = salesStr.replace(/[\$," ]/g, '');
  const salesVal = cleaned && !isNaN(cleaned) ? parseFloat(cleaned) : 0;
  
  totalRawSales += salesVal;
  
  // Group by project
  const projectKey = `${row.projectNumber}|${row.projectName}`;
  if (!projectMap.has(projectKey)) {
    projectMap.set(projectKey, { sales: 0, cost: 0, hours: 0, rows: 0 });
  }
  
  const project = projectMap.get(projectKey);
  project.sales += salesVal;
  
  const costStr = row.cost || '';
  const cleanedCost = costStr.replace(/[\$," ]/g, '');
  project.cost += cleanedCost && !isNaN(cleanedCost) ? parseFloat(cleanedCost) : 0;
  
  const hoursStr = row.hours || '';
  const cleanedHours = hoursStr.replace(/[\$," ]/g, '');
  project.hours += cleanedHours && !isNaN(cleanedHours) ? parseFloat(cleanedHours) : 0;
  
  project.rows++;
}

console.log(`\n=== CSV Analysis ===`);
console.log(`Total raw sales (sum of all rows): $${totalRawSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
console.log(`In millions: $${(totalRawSales/1000000).toFixed(2)}M`);
console.log(`\nTotal unique projects: ${projectMap.size}`);

let totalProjectSales = 0;
let totalProjectCost = 0;
let totalProjectHours = 0;

projectMap.forEach((project) => {
  totalProjectSales += project.sales;
  totalProjectCost += project.cost;
  totalProjectHours += project.hours;
});

console.log(`\nIf we sum by project (each project counted once with all its line items):`);
console.log(`Total Sales: $${totalProjectSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
console.log(`In millions: $${(totalProjectSales/1000000).toFixed(2)}M`);
console.log(`Total Cost: $${totalProjectCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
console.log(`Total Hours: ${totalProjectHours.toLocaleString('en-US')}`);
