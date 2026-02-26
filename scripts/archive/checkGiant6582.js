const fs = require('fs');

const csvPath = 'C:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (4).csv';
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

// Parse header
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
const projectNameIdx = headers.indexOf('projectName');
const scopeIdx = headers.indexOf('ScopeOfWork');
const customerIdx = headers.indexOf('customer');

// Find all rows for Giant #6582
const scopes = new Set();
for (let i = 1; i < lines.length; i++) {
  const parts = parseCSVLine(lines[i]);
  const projectName = parts[projectNameIdx]?.trim() || '';
  const customer = parts[customerIdx]?.trim() || '';
  const scopeOfWork = parts[scopeIdx]?.trim() || '';
  
  if (projectName === 'Giant #6582') {
    scopes.add(scopeOfWork);
  }
}

console.log(`Project: Giant #6582`);
console.log(`Unique scopes found: ${scopes.size}`);
if (scopes.size > 0) {
  console.log('\nScopes:');
  Array.from(scopes).forEach(scope => console.log(`  - ${scope}`));
}
