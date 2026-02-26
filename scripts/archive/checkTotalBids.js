const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');

function getProjectKey(projectNumber, customer) {
  const pn = (projectNumber || '').toString().trim().toLowerCase();
  const cn = (customer || '').toString().trim().toLowerCase();
  return `${pn}|${cn}`;
}

const allProjects = [];

fs.createReadStream(csvPath)
  .pipe(csv())
  .on('data', (row) => {
    const project = {
      projectNumber: row.ProjectNumber || row.projectNumber || '',
      customer: row.customer || '',
      projectName: row.ProjectName || row.projectName || '',
      status: row.status || '',
      projectArchived: row.ProjectArchived && row.ProjectArchived.toString().toLowerCase() === 'yes',
      estimator: row.estimator || ''
    };
    allProjects.push(project);
  })
  .on('end', () => {
    console.log(`Total rows read: ${allProjects.length}`);
    
    // Separate archived projects (count as lost for win rate)
    const archivedProjects = allProjects.filter(p => p.projectArchived);
    console.log(`\nArchived projects (raw): ${archivedProjects.length}`);
    
    // Filter non-archived projects (apply other exclusion rules)
    const filteredProjects = allProjects.filter(p => {
      // Don't filter out archived here - we'll count them separately
      const customer = (p.customer || '').toString().toLowerCase();
      if (customer.includes('sop inc')) return false;
      
      const projectName = (p.projectName || '').toString().toLowerCase();
      if (projectName === 'pmc operations') return false;
      if (projectName === 'pmc shop time') return false;
      if (projectName === 'pmc test project') return false;
      if (projectName.includes('sandbox')) return false;
      if (projectName.includes('raymond king')) return false;
      if (projectName === 'alexander drive addition latest') return false;
      
      if (!p.estimator || p.estimator.toLowerCase() === 'todd gilmore') return false;
      
      const projectNumber = (p.projectNumber || '').toString().toLowerCase();
      if (projectNumber === '701 poplar church rd') return false;
      
      return true;
    });
    
    console.log(`Projects after filters (excluding archived check): ${filteredProjects.length}`);
    
    // Now separate by archived status
    const nonArchivedFiltered = filteredProjects.filter(p => !p.projectArchived);
    const archivedFiltered = filteredProjects.filter(p => p.projectArchived);
    
    console.log(`Non-archived after filters: ${nonArchivedFiltered.length}`);
    console.log(`Archived after filters: ${archivedFiltered.length}`);
    
    // Group non-archived by key and status
    const statusMap = new Map();
    nonArchivedFiltered.forEach(p => {
      const status = (p.status || 'Unknown').toString();
      if (!statusMap.has(status)) {
        statusMap.set(status, []);
      }
      statusMap.get(status).push(p);
    });
    
    // Count unique projects per status
    const getUniqueCount = (status) => {
      const projects = statusMap.get(status) || [];
      return new Set(projects.map(p => getProjectKey(p.projectNumber, p.customer))).size;
    };
    
    // Count archived unique projects
    const archivedUniqueCount = new Set(archivedFiltered.map(p => 
      getProjectKey(p.projectNumber, p.customer)
    )).size;
    
    const bidSubmittedCount = getUniqueCount('Bid Submitted');
    const lostCount = getUniqueCount('Lost');
    const wonCount = getUniqueCount('Complete') + getUniqueCount('In Progress') + getUniqueCount('Accepted');
    
    console.log(`\n=== Win Rate Calculation ===`);
    console.log(`Bid Submitted: ${bidSubmittedCount}`);
    console.log(`Lost: ${lostCount}`);
    console.log(`Archived (counted as lost): ${archivedUniqueCount}`);
    console.log(`Total Bids: ${bidSubmittedCount + lostCount + archivedUniqueCount}`);
    console.log(`\nWon (Complete + In Progress + Accepted): ${wonCount}`);
    console.log(`Win Rate: ${((wonCount / (bidSubmittedCount + lostCount + archivedUniqueCount)) * 100).toFixed(1)}%`);
    
    console.log(`\n=== All Status Counts ===`);
    const allStatuses = Array.from(statusMap.keys()).sort();
    allStatuses.forEach(status => {
      console.log(`${status}: ${getUniqueCount(status)}`);
    });
  });
