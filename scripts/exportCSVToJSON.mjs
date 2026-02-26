import fs from 'fs';
import { parse } from 'csv-parse/sync';

const csvContent = fs.readFileSync('Bid_Distro-Preconstruction-Enriched.csv', 'utf-8');
const records = parse(csvContent, { columns: true, skip_empty_lines: true });

const projectMap = new Map();

records.forEach((row) => {
  const projectNumber = (row.projectNumber || '').trim();
  const customer = (row.customer || '').trim();
  const status = (row.status || '').trim();
  
  if (!projectNumber || !customer) return;
  if (customer.includes('Test') || customer.includes('test')) return;
  
  const key = `${projectNumber}|${customer}`;
  
  if (!projectMap.has(key)) {
    projectMap.set(key, {
      id: `p_${projectMap.size}`,
      projectNumber,
      projectName: row.projectName || '',
      customer,
      status: status || 'Unknown',
      sales: 0,
      cost: 0,
      hours: 0,
      estimator: row.estimator || '',
      dateCreated: null,
      dateUpdated: null,
      pmcBreakdown: {}
    });
  }
  
  const p = projectMap.get(key);
  const sales = parseFloat(row.sales?.replace(/[$,\s]/g, '') || '0') || 0;
  const cost = parseFloat(row.cost?.replace(/[$,\s]/g, '') || '0') || 0;
  const hours = parseFloat(row.hours || '0') || 0;
  const pmcGroup = (row.PMCGroup || '').trim() || 'Uncategorized';

  const createdRaw = (row.dateCreated || '').toString().trim();
  const updatedRaw = (row.dateUpdated || '').toString().trim();
  const createdDate = createdRaw ? new Date(createdRaw) : null;
  const updatedDate = updatedRaw ? new Date(updatedRaw) : null;
  const createdValid = createdDate && !Number.isNaN(createdDate.getTime());
  const updatedValid = updatedDate && !Number.isNaN(updatedDate.getTime());
  
  p.sales += sales;
  p.cost += cost;
  p.hours += hours;

  // Track PMCGroup breakdown
  if (!p.pmcBreakdown[pmcGroup]) {
    p.pmcBreakdown[pmcGroup] = { sales: 0, cost: 0, hours: 0 };
  }
  p.pmcBreakdown[pmcGroup].sales += sales;
  p.pmcBreakdown[pmcGroup].cost += cost;
  p.pmcBreakdown[pmcGroup].hours += hours;

  if (createdValid) {
    if (!p.dateCreated || new Date(p.dateCreated) > createdDate) {
      p.dateCreated = createdDate.toISOString();
    }
  }

  if (updatedValid) {
    if (!p.dateUpdated || new Date(p.dateUpdated) < updatedDate) {
      p.dateUpdated = updatedDate.toISOString();
    }
  }

  if (!p.dateCreated && updatedValid) {
    p.dateCreated = updatedDate.toISOString();
  }
});

const projects = Array.from(projectMap.values()).sort((a, b) => b.sales - a.sales);
fs.writeFileSync('public/projects-backup.json', JSON.stringify(projects, null, 2));

console.log('✓ Exported ' + projects.length + ' projects');
console.log('Total sales: $' + projects.reduce((s, p) => s + p.sales, 0).toLocaleString());
console.log('Total cost: $' + projects.reduce((s, p) => s + p.cost, 0).toLocaleString());
console.log('Total hours: ' + projects.reduce((s, p) => s + p.hours, 0).toLocaleString());
