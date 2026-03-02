import fs from 'fs';

const csvContent = fs.readFileSync('chosen-customers.csv', 'utf-8');
const lines = csvContent.split('\n');

// Filter for duplicates (last column = true)
const header = lines[0];
const duplicates = [header];

lines.slice(1).forEach(line => {
  if (line.trim().endsWith(',true')) {
    duplicates.push(line);
  }
});

// Save to file
fs.writeFileSync('duplicated-projects-only.csv', duplicates.join('\n'), 'utf-8');

console.log(`✅ Saved ${duplicates.length - 1} duplicated projects to duplicated-projects-only.csv\n`);

// Print to console
console.log('=== DUPLICATED PROJECTS ONLY ===\n');
console.log(header);
duplicates.slice(1).forEach((line, idx) => {
  console.log(line);
});
