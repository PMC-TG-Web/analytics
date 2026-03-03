const fs = require('fs');
const path = require('path');

const csvPath = 'C:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (4).csv';
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

console.log('CSV Header:');
console.log(lines[0].substring(0, 200));
console.log('\nFirst 3 data rows:');
for (let i = 1; i < 4; i++) {
  console.log(`Row ${i}: ${lines[i].substring(0, 200)}`);
}

// Parse header properly
const parseCSVLine = (line) => {
  const parts = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      parts.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim().replace(/^"|"$/g, ''));
  return parts;
};

const headers = parseCSVLine(lines[0]);
console.log('\nParsed Headers:');
headers.forEach((h, i) => console.log(`  [${i}] ${h}`));

console.log('\nFirst data row (parsed):');
const row1 = parseCSVLine(lines[1]);
headers.forEach((h, i) => {
  const val = row1[i] || '';
  console.log(`  [${i}] ${h}: ${val.substring(0, 80)}`);
});

// Find ScopeOfWork index
const scopeIdx = headers.indexOf('ScopeOfWork');
console.log(`\nScopeOfWork column index: ${scopeIdx}`);
if (scopeIdx >= 0) {
  console.log(`Row 1 ScopeOfWork: ${row1[scopeIdx]}`);
}
