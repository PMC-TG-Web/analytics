const fs = require('fs');
const path = require('path');

// Read CSV header
const csvPath = 'C:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (4).csv';
const content = fs.readFileSync(csvPath, 'utf-8');
const firstLine = content.split('\n')[0];
const secondLine = content.split('\n')[1];

fs.writeFileSync('c:\\temp\\csv_sample.txt', `HEADER:\n${firstLine}\n\nFIRST DATA ROW:\n${secondLine}`);

console.log('Saved CSV samples to c:\\temp\\csv_sample.txt');
