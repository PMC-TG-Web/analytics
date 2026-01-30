const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'src', 'Bid_Distro-Preconstruction (1).csv');

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value.toDate) return value.toDate();
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function getProjectKey(projectNumber, customer) {
  const pn = (projectNumber || '').toString().trim().toLowerCase();
  const cn = (customer || '').toString().trim().toLowerCase();
  return `${pn}|||${cn}`;
}

async function checkForTies() {
  console.log('Reading CSV file...');
  
  const allProjects = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        // Parse the row data
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
        
        const priorityStatuses = ["accepted", "in progress", "complete"];
        
        // Apply filters
        const filteredProjects = allProjects.filter(data => {
          // Apply all filters
          if (data.projectArchived === true) return false;
          if (data.customer && data.customer.toLowerCase().includes('sop inc')) return false;
          
          const projectNameLower = (data.projectName || '').toLowerCase();
          if (projectNameLower === 'pmc operations' ||
              projectNameLower === 'pmc shop time' ||
              projectNameLower === 'pmc test project' ||
              projectNameLower.includes('sandbox') ||
              projectNameLower.includes('raymond king') ||
              projectNameLower === 'alexander drive addition latest') return false;
          
          if (!data.estimator || data.estimator.toLowerCase() === 'todd gilmore') return false;
          
          const projectNumberLower = (data.projectNumber || '').toString().toLowerCase();
          if (projectNumberLower === '701 poplar church rd') return false;
          
          return true;
        });
        
        console.log(`Projects after filtering: ${filteredProjects.length}`);
        
        // Group by projectNumber + customer
        const projectMap = new Map();
        filteredProjects.forEach(project => {
          const key = getProjectKey(project.projectNumber, project.customer);
          if (!projectMap.has(key)) {
            projectMap.set(key, []);
          }
          projectMap.get(key).push(project);
        });
        
        console.log(`\nTotal unique project keys: ${projectMap.size}`);
        
        // Find duplicates and check for ties
        let duplicateGroups = 0;
        let tiesFound = 0;
        const tieExamples = [];
        
        projectMap.forEach((projects, key) => {
          if (projects.length > 1) {
            duplicateGroups++;
            
            // Separate by priority status
            const priorityProjects = projects.filter(p => 
              priorityStatuses.includes((p.status || '').toLowerCase())
            );
            const otherProjects = projects.filter(p => 
              !priorityStatuses.includes((p.status || '').toLowerCase())
            );
            
            let candidateGroup = priorityProjects.length > 0 ? priorityProjects : otherProjects;
            
            if (candidateGroup.length > 1) {
              // Check if there's a tie in dateCreated
              const dates = candidateGroup.map(p => {
                const date = parseDateValue(p.dateCreated);
                return date ? date.getTime() : 0;
              });
              
              const maxDate = Math.max(...dates);
              const projectsWithMaxDate = candidateGroup.filter(p => {
                const date = parseDateValue(p.dateCreated);
                const time = date ? date.getTime() : 0;
                return time === maxDate;
              });
              
              if (projectsWithMaxDate.length > 1) {
                tiesFound++;
                if (tieExamples.length < 5) {
                  tieExamples.push({
                    key,
                    projects: projectsWithMaxDate.map(p => ({
                      projectNumber: p.projectNumber,
                      customer: p.customer,
                      projectName: p.projectName,
                      status: p.status,
                      dateCreated: parseDateValue(p.dateCreated)?.toISOString() || 'null',
                      sales: p.sales
                    }))
                  });
                }
              }
            }
          }
        });
  
        console.log(`\nDuplicate groups (same projectNumber + customer): ${duplicateGroups}`);
        console.log(`Ties found (same status priority AND same dateCreated): ${tiesFound}`);
        
        if (tieExamples.length > 0) {
          console.log('\n=== Example Ties ===');
          tieExamples.forEach((tie, index) => {
            console.log(`\nTie #${index + 1}:`);
            console.log(`Key: ${tie.key}`);
            tie.projects.forEach((p, i) => {
              console.log(`  Project ${i + 1}:`);
              console.log(`    Number: ${p.projectNumber}`);
              console.log(`    Customer: ${p.customer}`);
              console.log(`    Name: ${p.projectName}`);
              console.log(`    Status: ${p.status}`);
              console.log(`    Date Created: ${p.dateCreated}`);
              console.log(`    Sales: ${p.sales}`);
            });
          });
        }
        
        resolve();
      })
      .on('error', (error) => {
        console.error('Error reading CSV:', error);
        reject(error);
      });
  });
}

checkForTies().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
