const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

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

(async () => {
  // Read CSV
  const csv = fs.readFileSync('scripts/WIP3.csv', 'utf8');
  const lines = csv.split('\n').filter(l => l.trim());
  const csvProjects = new Map();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 2) continue;
    const customer = fields[0];
    const projectName = fields[1];
    const key = customer + ' / ' + projectName;
    csvProjects.set(key, (csvProjects.get(key) || 0) + 1);
  }

  // Get projects from database
  const dbProjects = await prisma.project.findMany({
    select: { customer: true, projectName: true }
  });

  console.log(`\nWIP3.csv has ${csvProjects.size} unique customer/project combinations`);
  console.log(`Database has ${dbProjects.size} projects\n`);

  // Find which ones are missing
  const notFound = [];
  csvProjects.forEach((count, key) => {
    const [customer, projectName] = key.split(' / ');
    const exists = dbProjects.some(p =>
      p.customer?.toLowerCase().trim() === customer.toLowerCase().trim() &&
      p.projectName?.toLowerCase().trim() === projectName.toLowerCase().trim()
    );
    if (!exists) {
      notFound.push({ customer, projectName, rows: count });
    }
  });

  console.log(`❌ NOT FOUND in database (${notFound.length}):`);
  notFound.forEach(p => {
    console.log(`  [${p.rows} rows] "${p.customer}" / "${p.projectName}"`);
  });

  // Check for potential name mismatches
  console.log(`\n🔍 Checking for potential name mismatches...`);
  notFound.forEach(({ customer, projectName }) => {
    const possibleMatches = dbProjects.filter(p => {
      const custMatch = p.customer?.toLowerCase().includes(customer.toLowerCase()) ||
                       customer.toLowerCase().includes(p.customer?.toLowerCase() || '');
      const projMatch = p.projectName?.toLowerCase().includes(projectName.toLowerCase()) ||
                       projectName.toLowerCase().includes(p.projectName?.toLowerCase() || '');
      return custMatch || projMatch;
    });

    if (possibleMatches.length > 0) {
      console.log(`\n  "${customer}" / "${projectName}"`);
      possibleMatches.forEach(m => {
        console.log(`    → Possible match: "${m.customer}" / "${m.projectName}"`);
      });
    }
  });

  process.exit(0);
})();
