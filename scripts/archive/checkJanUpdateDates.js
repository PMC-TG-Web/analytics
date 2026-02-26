const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction.csv');

const projectMap = new Map();

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    const status = (row.status || '').trim();
    if (status !== 'Bid Submitted') return;

    const projectArchived = (row.ProjectArchived || '').toString().toLowerCase() === 'yes';
    if (projectArchived) return;

    const projectName = (row.projectName || '').trim();
    const projectNumber = (row.projectNumber || '').trim();
    const identifier = (projectNumber || projectName).trim();
    const customer = (row.customer || '').trim();
    const dateCreated = (row.dateCreated || '').trim();
    const updateDate = (row.ProjectUpdateDate || '').trim();
    const sales = parseFloat((row.sales || '0').toString().replace(/[$,]/g, '')) || 0;

    const d = new Date(dateCreated);
    if (isNaN(d.getTime()) || d.getFullYear() !== 2026 || d.getMonth() !== 0) return;

    if (!projectMap.has(identifier)) {
        projectMap.set(identifier, new Map());
    }
    const customerMap = projectMap.get(identifier);
    if (!customerMap.has(customer)) {
        customerMap.set(customer, { sales: 0, dateCreated, updateDate });
    }
    customerMap.get(customer).sales += sales;
  })
  .on('end', () => {
    const finalProjects = [];
    projectMap.forEach((customerMap, identifier) => {
        const customers = Array.from(customerMap.keys()).sort();
        const chosen = customerMap.get(customers[0]);
        finalProjects.push({ identifier, ...chosen });
    });

    finalProjects.sort((a, b) => b.sales - a.sales);

    console.log('--- Jan 2026 Bid Submitted Projects (DEDUPED) ---');
    finalProjects.forEach(p => {
        console.log(`${p.sales.toLocaleString().padStart(12)} | Updated: ${p.updateDate.padEnd(12)} | Created: ${p.dateCreated.padEnd(12)} | ${p.identifier}`);
    });
  });
