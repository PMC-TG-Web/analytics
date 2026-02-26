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
const projectNumberIdx = headers.indexOf('projectNumber');
const projectNameIdx = headers.indexOf('projectName');
const scopeIdx = headers.indexOf('ScopeOfWork');
const customerIdx = headers.indexOf('customer');

const projects = new Set();

for (let i = 1; i < lines.length; i++) {
  const parts = parseCSVLine(lines[i]);
  const projectName = parts[projectNameIdx];
  const customer = parts[customerIdx];
  const projectNumber = parts[projectNumberIdx];
  
  if (projectName && projectName.includes('Giant #6582')) {
    projects.add(`${projectNumber}|${projectName}|${customer}`);
  }
}

console.log(`\nAll variations of "Giant #6582" in CSV:\n`);
projects.forEach(p => console.log(`  ${p}`));
console.log(`\nTotal variations: ${projects.size}`);
