const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n');
const headers = lines[0].split(',');

let total = 0;
let count = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  const cols = line.split(',');
  const salesStr = cols[7] || '';
  const cleaned = salesStr.replace(/[\$," ]/g, '');
  
  if (cleaned && !isNaN(cleaned)) {
    total += parseFloat(cleaned);
    count++;
  }
}

console.log(`Total Sales: $${total.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
console.log(`In millions: $${(total/1000000).toFixed(2)}M`);
console.log(`Row count: ${count}`);
console.log(`Total rows in file: ${lines.length - 1}`);
