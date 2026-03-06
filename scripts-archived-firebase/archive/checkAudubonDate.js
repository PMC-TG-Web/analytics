const fs = require('fs');
const csv = require('csv-parse/sync');
const path = require('path');

function checkProjectDate() {
  const filePath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (5).csv';
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const csvRecords = csv.parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

  const audubon = csvRecords.find(r => 
    (r['Estimating Project > Estimate Project Name'] || '').includes('Audubon Collegeville')
  );

  if (audubon) {
    console.log('--- Project Details: Audubon Collegeville ---');
    for (const [key, value] of Object.entries(audubon)) {
      if (key.toLowerCase().includes('date') || key.toLowerCase().includes('bid')) {
        console.log(`${key}: ${value}`);
      }
    }
  } else {
    console.log('Audubon Collegeville not found in CSV.');
  }
}

checkProjectDate();
