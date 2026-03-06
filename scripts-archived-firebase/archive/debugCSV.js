const fs = require('fs');
const path = require('path');

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"' && nextChar === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

const csvPath = path.join(__dirname, '../src/app/Bid_Distro-Preconstruction (2).csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');
const lines = csvContent.split('\n');

console.log('Headers:', parseCSVLine(lines[0]));
console.log('\nFirst Giant record (line 88):');
const values88 = parseCSVLine(lines[87]); // Line 88 is index 87
parseCSVLine(lines[0]).forEach((header, i) => {
  console.log(`  ${header}: ${values88[i]}`);
});
