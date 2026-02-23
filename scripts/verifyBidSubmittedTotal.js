const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'Bid_Distro-Preconstruction.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');
const lines = csvContent.trim().split('\n');
const headers = lines[0].split(',');

console.log('CSV Analysis for Bid Submitted Projects');
console.log('==========================================\n');

// Parse CSV
const projects = [];
for (let i = 1; i < lines.length; i++) {
  const values = lines[i].split(',');
  const project = {};
  headers.forEach((header, index) => {
    project[header.trim()] = values[index] ? values[index].trim() : null;
  });
  projects.push(project);
}

console.log(`Total rows in CSV: ${projects.length}`);

// Filter for Bid Submitted and Estimating
const bidSubmitted = projects.filter(p => {
  const status = (p.status || '').trim();
  return status === 'Bid Submitted' || status === 'Estimating';
});

console.log(`Bid Submitted/Estimating rows: ${bidSubmitted.length}`);

// Show sample statuses to debug
const uniqueStatuses = new Set(projects.map(p => (p.status || '').trim()).filter(Boolean));
console.log(`Unique status values in CSV: ${Array.from(uniqueStatuses).join(', ')}\n`);

// Calculate total WITHOUT deduplication
const totalWithoutDedup = bidSubmitted.reduce((sum, p) => {
  const salesStr = (p.sales || '').toString().replace(/[$,\s]/g, '');
  const sales = parseFloat(salesStr) || 0;
  return sum + sales;
}, 0);

console.log(`Total sales WITHOUT deduplication: $${totalWithoutDedup.toLocaleString()}`);

// Now deduplicate using the same logic as the app
function getProjectKey(customer, projectNumber, projectName) {
  const cust = (customer || '').trim().toLowerCase();
  const num = (projectNumber || '').trim().toLowerCase();
  const name = (projectName || '').trim().toLowerCase();
  return `${cust}|${num}|${name}`;
}

// Stage 1: Group by project identifier for competitive bidding dedup
const identifierMap = new Map();
bidSubmitted.forEach(project => {
  const projectNumber = (project.projectNumber || '').trim();
  const projectName = (project.projectName || '').trim();
  const identifier = projectNumber || projectName || '(unknown)';
  
  if (!identifierMap.has(identifier)) {
    identifierMap.set(identifier, new Map());
  }
  
  const customerMap = identifierMap.get(identifier);
  const customer = (project.customer || '').trim();
  
  if (!customerMap.has(customer)) {
    customerMap.set(customer, []);
  }
  
  customerMap.get(customer).push(project);
});

// Stage 1: Pick one customer per identifier
const dedupedByCustomer = [];
identifierMap.forEach((customerMap, identifier) => {
  if (customerMap.size > 1) {
    // Multiple customers - pick by status priority
    const statusPriority = {
      'Complete': 1,
      'Post-construction Complete': 2,
      'In Progress': 3,
      'Accepted': 4,
      'Scheduled': 5,
      'Bid Submitted': 6,
      'Estimating': 7,
      'Archived': 8
    };
    
    let selectedCustomer = null;
    let maxPriority = 99;
    let latestDate = null;
    let maxSales = 0;
    
    customerMap.forEach((projects, customer) => {
      const topStatus = projects.reduce((best, p) => {
        const pStatus = (p.status || '').trim();
        const pPriority = statusPriority[pStatus] || 99;
        const bPriority = statusPriority[best] || 99;
        return pPriority < bPriority ? pStatus : best;
      }, 'Estimating');
      
      const priority = statusPriority[topStatus] || 99;
      
      if (priority < maxPriority) {
        maxPriority = priority;
        selectedCustomer = customer;
        const totalSales = projects.reduce((sum, p) => {
          const salesStr = (p.sales || '').toString().replace(/[$,\s]/g, '');
          return sum + (parseFloat(salesStr) || 0);
        }, 0);
        maxSales = totalSales;
      } else if (priority === maxPriority) {
        // Use date as tiebreaker
        const mostRecent = projects.reduce((latest, current) => {
          const latestDate = latest.dateCreated || latest.dateUpdated || '';
          const currentDate = current.dateCreated || current.dateUpdated || '';
          return currentDate > latestDate ? current : latest;
        }, projects[0]);
        
        const projDate = mostRecent.dateCreated || mostRecent.dateUpdated;
        const projSales = projects.reduce((sum, p) => {
          const salesStr = (p.sales || '').toString().replace(/[$,\s]/g, '');
          return sum + (parseFloat(salesStr) || 0);
        }, 0);
        
        if (projDate && (!latestDate || projDate > latestDate || (projDate === latestDate && projSales > maxSales))) {
          latestDate = projDate;
          selectedCustomer = customer;
          maxSales = projSales;
        }
      }
    });
    
    const selectedProjects = customerMap.get(selectedCustomer) || [];
    dedupedByCustomer.push(...selectedProjects);
  } else {
    // Only one customer for this identifier
    customerMap.forEach(projects => dedupedByCustomer.push(...projects));
  }
});

console.log(`\nAfter Stage 1 (competitive dedup): ${dedupedByCustomer.length} line items`);

const totalAfterStage1 = dedupedByCustomer.reduce((sum, p) => {
  const salesStr = (p.sales || '').toString().replace(/[$,\s]/g, '');
  return sum + (parseFloat(salesStr) || 0);
}, 0);

console.log(`Total sales after Stage 1: $${totalAfterStage1.toLocaleString()}`);

// Stage 2: Aggregate line items per project
const keyGroupMap = new Map();
dedupedByCustomer.forEach(project => {
  const customer = project.customer || '';
  const projectNumber = project.projectNumber || '';
  const projectName = project.projectName || '';
  const key = getProjectKey(customer, projectNumber, projectName);
  
  if (!keyGroupMap.has(key)) {
    keyGroupMap.set(key, []);
  }
  
  keyGroupMap.get(key).push(project);
});

console.log(`\nAfter Stage 2 (line item aggregation): ${keyGroupMap.size} unique projects`);

// Calculate aggregated total
let totalAfterStage2 = 0;
keyGroupMap.forEach((lineItems, key) => {
  const projectSales = lineItems.reduce((sum, p) => {
    const salesStr = (p.sales || '').toString().replace(/[$,\s]/g, '');
    return sum + (parseFloat(salesStr) || 0);
  }, 0);
  totalAfterStage2 += projectSales;
});

console.log(`Total sales after Stage 2 (FINAL): $${totalAfterStage2.toLocaleString()}`);

console.log('\n==========================================');
console.log('Summary:');
console.log(`  Raw line items: ${bidSubmitted.length}`);
console.log(`  After competitive dedup: ${dedupedByCustomer.length} line items`);
console.log(`  After line item aggregation: ${keyGroupMap.size} projects`);
console.log(`  FINAL TOTAL: $${totalAfterStage2.toLocaleString()}`);
