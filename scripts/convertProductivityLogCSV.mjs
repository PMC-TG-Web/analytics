#!/usr/bin/env node

/**
 * Convert Productivity Log CSV to Procore JSON format
 * 
 * Usage:
 *   node convertProductivityLogCSV.mjs <csv-file> <project-id> [output-file]
 * 
 * Example:
 *   node convertProductivityLogCSV.mjs "Productivity_Log (7).csv" "598134326626273" output.json
 * 
 * The script will:
 * 1. Read the CSV file
 * 2. Parse CSV into JSON rows
 * 3. Match CSV rows to line item descriptions
 * 4. Generate a JSON file with the converted logs ready for API submission
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple CSV parser with quote handling
function parseCSV(content) {
  const lines = content.split('\n');
  if (lines.length < 1) return { headers: [], rows: [] };

  // Parse header line with quoted field support
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().trim());

  // Parse data lines
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

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
        i++; // Skip next quote
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

  result.push(current.trim());
  return result;
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node convertProductivityLogCSV.mjs <csv-file> <project-id> [output-file]');
  console.error('Example: node convertProductivityLogCSV.mjs "Productivity_Log (7).csv" "598134326626273" output.json');
  process.exit(1);
}

const csvFile = args[0];
const projectId = args[1];
const outputFile = args[2] || 'productivity_logs_output.json';

// Read CSV file
if (!fs.existsSync(csvFile)) {
  console.error(`Error: File not found: ${csvFile}`);
  process.exit(1);
}

const csvContent = fs.readFileSync(csvFile, 'utf-8');
const { headers, rows } = parseCSV(csvContent);

console.log(`✓ Parsed ${rows.length} rows from ${csvFile}`);
console.log(`  Headers: ${headers.join(', ')}`);

// Group rows by Contract and Line Item to create a mapping
const lineItemMapping = new Map();
const contractLineItemPairs = new Set();

rows.forEach((row) => {
  const contract = (row.contract || '').trim();
  const lineItem = (row['line item'] || '').trim();
  
  if (contract && lineItem) {
    const key = `${contract}|${lineItem}`;
    contractLineItemPairs.add(key);
    
    // Extract line item number if present (e.g., "#1 - Ready Mix..." -> "#1")
    const match = lineItem.match(/^(#\d+)/);
    const lineItemNum = match ? match[1] : lineItem;
    
    lineItemMapping.set(key, {
      contract,
      lineItem,
      lineItemNum,
      description: lineItem,
    });
  }
});

console.log(`\n📋 Found ${contractLineItemPairs.size} unique contract+line item pairs:`);
contractLineItemPairs.forEach((pair) => {
  const [contract, lineItem] = pair.split('|');
  console.log(`   • "${contract}" -> "${lineItem}"`);
});

// Convert CSV rows to JSON format
const logs = rows
  .map((row) => {
    const date = (row.date || '').trim();
    const contract = (row.contract || '').trim();
    const lineItem = (row['line item'] || '').trim();
    const quantityDelivered = parseFloat(row['quantity delivered'] || '0') || 0;
    const comments = (row.comments || '').trim();

    if (!date || !contract || !lineItem) {
      return null; // Skip incomplete rows
    }

    // Placeholder for line_item_id - will need manual mapping
    return {
      date,
      line_item_id: null, // TODO: map from contract + line item description
      quantity_delivered: quantityDelivered > 0 ? quantityDelivered : undefined,
      notes: comments || undefined,
      // Reference fields for manual lookup
      _csv_contract: contract,
      _csv_line_item: lineItem,
    };
  })
  .filter((log) => log !== null);

console.log(`\n✓ Converted ${logs.length} rows to JSON format`);

// Output structure
const output = {
  project_id: projectId,
  generated_at: new Date().toISOString(),
  total_logs: logs.length,
  note: 'line_item_id values are null - use _csv_contract and _csv_line_item to map from Procore API',
  line_item_mapping: Array.from(contractLineItemPairs).map((pair) => {
    const [contract, lineItem] = pair.split('|');
    return { contract, line_item: lineItem, line_item_id: null };
  }),
  logs,
};

// Write JSON file
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log(`\n✓ Output saved to: ${outputFile}`);

console.log(`\n📝 Next steps:`);
console.log(`\n1. Get line item IDs from Procore:`);
console.log(`   • Go to http://localhost:3000/procore`);
console.log(`   • Enter Project ID: ${projectId}`);
console.log(`   • Click "Load Approved Line Items"`);
console.log(`   • Use the dropdown data to map contract + line item names to IDs`);
console.log(`\n2. Update the JSON:`);
console.log(`   • For each log entry, set line_item_id using _csv_contract and _csv_line_item`);
console.log(`\n3. Use bulk API or submit individually`);
