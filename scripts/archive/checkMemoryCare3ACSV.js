const fs = require('fs');
const csv = require('csv-parse/sync');

const csvPath = 'c:\\Users\\ToddGilmore\\Analytics\\src\\app\\Bid_Distro-Preconstruction (2).csv';
const csvContent = fs.readFileSync(csvPath, 'utf-8');
const records = csv.parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  ltrim: true,
  rtrim: true,
});

// Filter for Memory Care 3A
const mc3aRecords = records.filter(r => {
  const pn = r.projectNumber ? r.projectNumber.trim() : '';
  const pname = r.projectName ? r.projectName.trim() : '';
  return pn === '2510 - MC3A' || pname === 'Memory Care 3A';
});

console.log(`Found ${mc3aRecords.length} Memory Care 3A records in CSV\n`);

// Parse sales values
const parseSalesValue = (val) => {
  if (!val) return 0;
  const str = val.toString().trim();
  if (str.startsWith('(') && str.endsWith(')')) {
    // Accounting format: (value) = negative
    return -parseFloat(str.slice(1, -1).replace(/[^0-9.-]/g, '')) || 0;
  }
  return parseFloat(str.replace(/[^0-9.-]/g, '')) || 0;
};

let totalSales = 0;
mc3aRecords.forEach((record, idx) => {
  const sales = parseSalesValue(record.sales);
  totalSales += sales;
  console.log(`${idx + 1}. [${record.Costitems}] Sales: $${sales.toFixed(2)}`);
});

console.log(`\n✓ CSV Total Sales for Memory Care 3A: $${totalSales.toFixed(2)}`);
