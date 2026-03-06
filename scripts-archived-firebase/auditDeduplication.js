const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction.csv');

let seen = new Map(); // Name -> Set of IDs
let projects = [];

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    if ((row.status || '').trim() !== 'Bid Submitted') return;
    
    // Filters
    if ((row.ProjectArchived || '').toLowerCase() === 'yes') return;
    const pName = (row.projectName || '').trim();
    if (!pName) return;
    const pNum = (row.projectNumber || '').trim();
    
    // CURRENT LOGIC ID
    const currentId = (pNum || pName).toLowerCase();
    
    if (!seen.has(pName.toLowerCase())) seen.set(pName.toLowerCase(), new Set());
    seen.get(pName.toLowerCase()).add(currentId);
    
    projects.push({ name: pName, num: pNum, id: currentId, sales: parseFloat((row.sales || '0').replace(/[$,]/g, '')) || 0, date: row.dateCreated });
  })
  .on('end', () => {
    console.log('--- Checking for split identifiers (Same Name, Different IDs) ---');
    let duplicatesFound = false;
    seen.forEach((ids, name) => {
      if (ids.size > 1) {
        duplicatesFound = true;
        console.log(`\nName: "${name}"`);
        console.log(`  IDs used: ${Array.from(ids).join(' AND ')}`);
        
        // Check if any of these are in Jan 2026
        const instances = projects.filter(p => p.name.toLowerCase() === name);
        instances.forEach(i => {
            const d = new Date(i.date);
            if (d.getFullYear() === 2026 && d.getMonth() === 0) {
                console.log(`  !! Used in Jan 2026: ID ${i.id}, Sales $${i.sales.toLocaleString()}`);
            }
        });
      }
    });
    
    if (!duplicatesFound) console.log('None found. The identifier logic seems consistent for names.');
  });
