const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

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
      dateCreated: row.DateCreated || row.dateCreated || '',
      sales: parseFloat((row.sales || '0').toString().replace(/[$,]/g, '')) || 0,
      projectArchived: row.ProjectArchived && row.ProjectArchived.toString().toLowerCase() === 'yes',
      estimator: row.estimator || ''
    };
    allProjects.push(project);
  })
  .on('end', () => {
    console.log(`Total rows read: ${allProjects.length}`);
    
    // Step 1: Filter activeProjects (non-archived with exclusions)
    const activeProjects = allProjects.filter(p => {
      if (p.projectArchived) return false;
      const customer = (p.customer || '').toString().toLowerCase();
      if (customer.includes('sop inc')) return false;
      const projectName = (p.projectName || '').toString().toLowerCase();
      if (projectName === 'pmc operations') return false;
      if (projectName === 'pmc shop time') return false;
      if (projectName === 'pmc test project') return false;
      if (projectName.includes('sandbox')) return false;
      if (projectName.includes('raymond king')) return false;
      if (projectName === 'alexander drive addition latest') return false;
      const estimator = (p.estimator || '').toString().trim();
      if (!estimator) return false;
      if (estimator.toLowerCase() === 'todd gilmore') return false;
      const projectNumber = (p.projectNumber || '').toString().toLowerCase();
      if (projectNumber === '701 poplar church rd') return false;
      return true;
    });
    
    console.log(`Active projects after filters: ${activeProjects.length}`);
    
    // Step 2: Group by project identifier (number or name) to find duplicates with different customers
    const projectIdentifierMap = new Map();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber || project.projectName || '').toString().trim();
      if (!identifier) return;
      
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier).push(project);
    });
    
    // Step 3: For each identifier, deduplicate by customer
    const dedupedByCustomer = [];
    const priorityStatuses = ["accepted", "in progress", "complete"];
    
    projectIdentifierMap.forEach((projectList, identifier) => {
      // Group by customer
      const customerMap = new Map();
      projectList.forEach(p => {
        const customer = (p.customer || '').toString().trim();
        if (!customerMap.has(customer)) {
          customerMap.set(customer, []);
        }
        customerMap.get(customer).push(p);
      });
      
      // If multiple customers, pick one based on status priority or date
      if (customerMap.size > 1) {
        let selectedCustomer = "";
        let selectedProjects = [];
        
        // Check for priority status
        let foundPriorityCustomer = false;
        customerMap.forEach((projs, customer) => {
          const hasPriorityStatus = projs.some(p => priorityStatuses.includes((p.status || '').toLowerCase()));
          if (hasPriorityStatus && !foundPriorityCustomer) {
            selectedCustomer = customer;
            selectedProjects = projs;
            foundPriorityCustomer = true;
          }
        });
        
        // If no priority status, use date logic
        if (!foundPriorityCustomer) {
          let latestCustomer = "";
          let latestDate = null;
          
          customerMap.forEach((projs, customer) => {
            const mostRecentProj = projs.reduce((latest, current) => {
              const currentDate = parseDateValue(current.dateCreated);
              const latestDateVal = parseDateValue(latest.dateCreated);
              if (!currentDate) return latest;
              if (!latestDateVal) return current;
              return currentDate > latestDateVal ? current : latest;
            }, projs[0]);
            
            const projDate = parseDateValue(mostRecentProj.dateCreated);
            if (projDate && (!latestDate || projDate > latestDate)) {
              latestDate = projDate;
              latestCustomer = customer;
            }
          });
          
          selectedCustomer = latestCustomer;
          selectedProjects = customerMap.get(latestCustomer) || [];
        }
        
        dedupedByCustomer.push(...selectedProjects);
      } else {
        // Only one customer, keep all
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    console.log(`After customer deduplication: ${dedupedByCustomer.length}`);
    
    // Step 4: Group by key and apply alphabetic tiebreaker, then aggregate
    const keyGroupMap = new Map();
    dedupedByCustomer.forEach((project) => {
      const key = getProjectKey(project.projectNumber, project.customer);
      if (!keyGroupMap.has(key)) {
        keyGroupMap.set(key, []);
      }
      keyGroupMap.get(key).push(project);
    });
    
    const aggregatedProjects = [];
    keyGroupMap.forEach((projects, key) => {
      // Sort by projectName alphabetically
      const sortedProjects = projects.sort((a, b) => {
        const nameA = (a.projectName || '').toString().toLowerCase();
        const nameB = (b.projectName || '').toString().toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      const baseProject = sortedProjects[0];
      aggregatedProjects.push({
        ...baseProject,
        key,
        sales: sortedProjects.reduce((sum, p) => sum + (p.sales || 0), 0)
      });
    });
    
    console.log(`Aggregated projects: ${aggregatedProjects.length}`);
    
    // Step 5: Count by status
    const statusGroups = {};
    aggregatedProjects.forEach((p) => {
      const status = p.status || 'Unknown';
      if (!statusGroups[status]) statusGroups[status] = [];
      statusGroups[status].push(p);
    });
    
    const getUniqueProjectCount = (statusKey) => {
      const group = statusGroups[statusKey] || [];
      return new Set(group.map(p => p.key)).size;
    };
    
    // Step 6: Count archived with same filters
    const archivedProjects = allProjects.filter(p => {
      if (!p.projectArchived) return false;
      const customer = (p.customer || '').toString().toLowerCase();
      if (customer.includes('sop inc')) return false;
      const projectName = (p.projectName || '').toString().toLowerCase();
      if (projectName === 'pmc operations') return false;
      if (projectName === 'pmc shop time') return false;
      if (projectName === 'pmc test project') return false;
      if (projectName.includes('sandbox')) return false;
      if (projectName.includes('raymond king')) return false;
      if (projectName === 'alexander drive addition latest') return false;
      const estimator = (p.estimator || '').toString().trim();
      if (!estimator) return false;
      if (estimator.toLowerCase() === 'todd gilmore') return false;
      const projectNumber = (p.projectNumber || '').toString().toLowerCase();
      if (projectNumber === '701 poplar church rd') return false;
      return true;
    });
    
    const archivedCount = new Set(archivedProjects.map(p => getProjectKey(p.projectNumber, p.customer))).size;
    
    console.log(`\n=== Status Counts (Dashboard Logic) ===`);
    const allStatuses = Object.keys(statusGroups).sort();
    allStatuses.forEach(status => {
      console.log(`${status}: ${getUniqueProjectCount(status)}`);
    });
    
    console.log(`\n=== Win Rate Calculation ===`);
    const bidSubmittedCount = getUniqueProjectCount('Bid Submitted');
    const lostCount = getUniqueProjectCount('Lost');
    const wonCount = getUniqueProjectCount('Complete') + getUniqueProjectCount('In Progress') + getUniqueProjectCount('Accepted');
    
    console.log(`Bid Submitted: ${bidSubmittedCount}`);
    console.log(`Lost: ${lostCount}`);
    console.log(`Archived (counted as lost): ${archivedCount}`);
    console.log(`Total Bids: ${bidSubmittedCount + lostCount + archivedCount}`);
    console.log(`Won: ${wonCount}`);
    console.log(`Win Rate: ${((wonCount / (bidSubmittedCount + lostCount + archivedCount)) * 100).toFixed(1)}%`);
  });
