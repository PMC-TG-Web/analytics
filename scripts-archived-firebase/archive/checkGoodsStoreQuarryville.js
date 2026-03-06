const fs = require('fs');
const csv = require('csv-parse/sync');

const filePath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (2).csv';
const fileContent = fs.readFileSync(filePath, 'utf-8');
const records = csv.parse(fileContent, { columns: true, skip_empty_lines: true });

const goodsStoreItems = records.filter(r => 
  (r['Project Name'] || '').toLowerCase().includes('goods store quarryville')
);

console.log(`\nTotal line items for Goods Store Quarryville: ${goodsStoreItems.length}\n`);

let totalSales = 0;
goodsStoreItems.forEach((item, idx) => {
  const sales = parseFloat((item['Sales'] || '0').toString().replace(/[$,]/g, '')) || 0;
  totalSales += sales;
  console.log(`${idx + 1}. ${item['Cost Items'] || 'N/A'}: $${sales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
});

console.log(`\n=== TOTAL SALES: $${totalSales.toLocaleString(undefined, { maximumFractionDigits: 2 })} ===`);
