const fs = require('fs');

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current) result.push(current.trim());
  return result;
}

const csv = fs.readFileSync('scripts/WIP3.csv', 'utf8');
const lines = csv.split('\n').filter(l => l.trim());
const projects = new Map();

for (let i = 1; i < lines.length; i++) {
  const fields = parseCSVLine(lines[i]);
  if (fields.length < 2) continue;
  const key = fields[0] + ' / ' + fields[1];
  projects.set(key, (projects.get(key) || 0) + 1);
}

console.log('Unique customer/project combinations in WIP3.csv:', projects.size);
console.log('Total rows:', lines.length - 1);
Array.from(projects.entries()).sort().forEach(([key, count]) => {
  console.log(`  [${count}] ${key}`);
});
