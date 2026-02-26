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

console.log(`CSV Headers: ${headers.length} columns`);
console.log(`Using columns - projectName[${projectNameIdx}], customer[${customerIdx}], scope[${scopeIdx}]\n`);

const scopes = new Map();

for (let i = 1; i < lines.length; i++) {
  const parts = parseCSVLine(lines[i]);
  const projectName = parts[projectNameIdx];
  const customer = parts[customerIdx];
  const scope = parts[scopeIdx];
  
  if (projectName && projectName.includes('Giant #6582') && customer === 'Ames Construction, Inc.') {
    const key = `${customer}|${projectName}|${scope}`;
    if (!scopes.has(key)) {
      scopes.set(key, 0);
    }
    scopes.set(key, scopes.get(key) + 1);
  }
}

console.log(`Total unique scopes in CSV for Ames + Giant #6582: ${scopes.size}`);
console.log(`\nScope counts (showing duplicates):\n`);

scopes.forEach((count, key) => {
  if (count > 1) {
    const scope = key.split('|')[2];
    console.log(`${count}x: "${scope}"`);
  }
});

let totalCount = 0;
scopes.forEach(count => totalCount += count);
console.log(`\nTotal CSV rows for this combination: ${totalCount}`);
