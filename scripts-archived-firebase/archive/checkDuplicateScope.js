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

const scopes = new Set();

for (let i = 1; i < lines.length; i++) {
  const parts = parseCSVLine(lines[i]);
  const projectName = parts[projectNameIdx];
  const customer = parts[customerIdx];
  const scope = parts[scopeIdx];
  
  if (customer === 'Ames Construction, Inc.' && projectName === 'Giant #6582' && scope.includes('1,904 Sq Ft')) {
    scopes.add(scope);
    console.log(`[CSV Row ${i}]: "${scope}" (length: ${scope.length})`);
  }
}

console.log(`\nUnique variations: ${scopes.size}`);
