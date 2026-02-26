import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Reading Status.csv...');
const csvPath = path.join(__dirname, '..', 'Status.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

const records = parse(csvContent, { 
  columns: true, 
  skip_empty_lines: true,
  bom: true,
  trim: true
});

console.log(`Found ${records.length} records in Status.csv`);

// Deduplicate by projectNumber + customer + projectName
const projectMap = new Map();
let duplicateCount = 0;

records.forEach((row, index) => {
  const projectNumber = (row.projectNumber || '').trim();
  const projectName = (row.projectName || '').trim();
  const customer = (row.customer || '').trim();
  
  // Skip empty rows
  if (!projectName || !customer) return;
  
  // Create unique key by customer + projectName
  const key = `${customer}|${projectName}`;
  
  const sales = parseFloat(row.sales?.replace(/[$,\s]/g, '') || '0') || 0;
  const cost = parseFloat(row.cost?.replace(/[$,\s]/g, '') || '0') || 0;
  const hours = parseFloat(row.hours || '0') || 0;
  const laborSales = parseFloat(row.LaborSales?.replace(/[$,\s]/g, '') || '0') || 0;
  const laborCost = parseFloat(row.LaborCost?.replace(/[$,\s]/g, '') || '0') || 0;
  const quantity = parseFloat(row.Quantity || '0') || 0;
  
  // Parse dates
  const createdRaw = (row.dateCreated || '').toString().trim();
  const createdDate = createdRaw ? new Date(createdRaw) : null;
  const createdValid = createdDate && !Number.isNaN(createdDate.getTime());
  
  if (projectMap.has(key)) {
    // Duplicate found - keep the one with higher sales or more recent date
    duplicateCount++;
    const existing = projectMap.get(key);
    
    // Keep the record with higher sales, or if same, the more recent one
    if (sales > existing.sales || 
        (sales === existing.sales && createdValid && existing.dateCreated && 
         new Date(existing.dateCreated) < createdDate)) {
      projectMap.set(key, {
        id: existing.id, // Keep original ID
        projectNumber: projectNumber || existing.projectNumber,
        projectName,
        customer,
        status: (row.status || '').trim() || existing.status,
        sales,
        cost,
        hours,
        laborSales,
        laborCost,
        quantity,
        estimator: (row.estimator || '').trim() || existing.estimator,
        dateCreated: createdValid ? createdDate.toISOString() : existing.dateCreated,
        archived: (row.ProjectArchived || '').trim() === 'Yes',
        active: (row.Active || '').trim() === 'Yes',
      });
    }
  } else {
    // New project
    projectMap.set(key, {
      id: `p_${projectMap.size}`,
      projectNumber: projectNumber || `PROJ-${projectMap.size}`,
      projectName,
      customer,
      status: (row.status || '').trim() || 'Unknown',
      sales,
      cost,
      hours,
      laborSales,
      laborCost,
      quantity,
      estimator: (row.estimator || '').trim(),
      dateCreated: createdValid ? createdDate.toISOString() : null,
      archived: (row.ProjectArchived || '').trim() === 'Yes',
      active: (row.Active || '').trim() === 'Yes',
    });
  }
});

console.log(`Deduplicated: ${duplicateCount} duplicate records removed`);

const projects = Array.from(projectMap.values())
  .sort((a, b) => b.sales - a.sales);

const outputPath = path.join(__dirname, '..', 'public', 'projects-backup.json');
fs.writeFileSync(outputPath, JSON.stringify(projects, null, 2));

console.log('\n✓ Exported ' + projects.length + ' projects from Status.csv');
console.log('Total sales: $' + projects.reduce((s, p) => s + p.sales, 0).toLocaleString());
console.log('Total cost: $' + projects.reduce((s, p) => s + p.cost, 0).toLocaleString());
console.log('Total hours: ' + projects.reduce((s, p) => s + p.hours, 0).toLocaleString());
console.log('Total labor sales: $' + projects.reduce((s, p) => s + p.laborSales, 0).toLocaleString());
console.log('Total labor cost: $' + projects.reduce((s, p) => s + p.laborCost, 0).toLocaleString());

// Show status breakdown
const statusCounts = {};
projects.forEach(p => {
  statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
});

console.log('\nProjects by status:');
Object.entries(statusCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([status, count]) => {
    const totalSales = projects
      .filter(p => p.status === status)
      .reduce((sum, p) => sum + p.sales, 0);
    console.log(`  ${status}: ${count} projects ($${Math.round(totalSales).toLocaleString()})`);
  });
