import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CSV with proper handling of quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

console.log('Reading PMCGrouping.csv...');
const groupingPath = path.join(__dirname, '..', 'PMCGrouping.csv');
const groupingContent = fs.readFileSync(groupingPath, 'utf8');
const groupingLines = groupingContent.split('\n').filter(line => line.trim());

// Build lookup map: CostItem -> PMCGroup
const pmcGroupMap = new Map();
const groupingHeaders = parseCSVLine(groupingLines[0]);
const costItemIndex = groupingHeaders.indexOf('CostItem');
const pmcGroupIndex = groupingHeaders.indexOf('PMCGroup');

console.log(`Found ${groupingLines.length - 1} grouping entries`);

for (let i = 1; i < groupingLines.length; i++) {
  const fields = parseCSVLine(groupingLines[i]);
  const costItem = fields[costItemIndex]?.trim();
  const pmcGroup = fields[pmcGroupIndex]?.trim();
  
  if (costItem && pmcGroup) {
    pmcGroupMap.set(costItem, pmcGroup);
  }
}

console.log(`Created lookup map with ${pmcGroupMap.size} unique cost items`);

// Read master file
console.log('\nReading Bid_Distro-Preconstruction.csv...');
const masterPath = path.join(__dirname, '..', 'Bid_Distro-Preconstruction.csv');
const masterContent = fs.readFileSync(masterPath, 'utf8');
const masterLines = masterContent.split('\n');

// Parse headers
const masterHeaders = parseCSVLine(masterLines[0]);
const costitemsIndex = masterHeaders.indexOf('Costitems');

console.log(`Master file has ${masterLines.length - 1} rows`);
console.log(`Costitems column is at index ${costitemsIndex}`);

// Add PMCGroup column header
const newHeaders = [...masterHeaders, 'PMCGroup'];
const outputLines = [];
outputLines.push(newHeaders.join(','));

// Process each row
let matchedCount = 0;
let unmatchedCount = 0;
const unmatchedItems = new Set();

for (let i = 1; i < masterLines.length; i++) {
  const line = masterLines[i].trim();
  if (!line) continue;
  
  const fields = parseCSVLine(line);
  const costitem = fields[costitemsIndex]?.trim();
  
  // Look up PMCGroup
  let pmcGroup = '';
  if (costitem) {
    pmcGroup = pmcGroupMap.get(costitem) || '';
    if (pmcGroup) {
      matchedCount++;
    } else {
      unmatchedCount++;
      unmatchedItems.add(costitem);
    }
  }
  
  // Add PMCGroup to the row
  const newRow = [...fields, pmcGroup];
  
  // Re-quote fields that contain commas
  const quotedRow = newRow.map(field => {
    if (field.includes(',') || field.includes('"')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  });
  
  outputLines.push(quotedRow.join(','));
}

// Write enriched file
const outputPath = path.join(__dirname, '..', 'Bid_Distro-Preconstruction-Enriched.csv');
fs.writeFileSync(outputPath, outputLines.join('\n'));

console.log('\n✓ Enriched file created: Bid_Distro-Preconstruction-Enriched.csv');
console.log(`  Matched: ${matchedCount} rows`);
console.log(`  Unmatched: ${unmatchedCount} rows`);

if (unmatchedItems.size > 0 && unmatchedItems.size <= 20) {
  console.log('\nUnmatched cost items:');
  Array.from(unmatchedItems).slice(0, 20).forEach(item => {
    console.log(`  - ${item}`);
  });
} else if (unmatchedItems.size > 20) {
  console.log(`\n${unmatchedItems.size} unique unmatched cost items`);
  console.log('First 10:');
  Array.from(unmatchedItems).slice(0, 10).forEach(item => {
    console.log(`  - ${item}`);
  });
}

// Also update the export script to include PMCGroup
console.log('\nUpdating exportCSVToJSON.mjs to use enriched file...');
const exportScriptPath = path.join(__dirname, 'exportCSVToJSON.mjs');
let exportScript = fs.readFileSync(exportScriptPath, 'utf8');

if (exportScript.includes('Bid_Distro-Preconstruction.csv')) {
  exportScript = exportScript.replace(
    /Bid_Distro-Preconstruction\.csv/g,
    'Bid_Distro-Preconstruction-Enriched.csv'
  );
  fs.writeFileSync(exportScriptPath, exportScript);
  console.log('✓ Updated exportCSVToJSON.mjs to use enriched file');
} else {
  console.log('⚠ exportCSVToJSON.mjs already updated or using different file');
}
