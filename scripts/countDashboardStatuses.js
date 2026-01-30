const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  return null;
}

async function countDashboardProjects() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    const projects = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Apply filters
    const activeProjects = projects.filter(p => {
      if (p.projectArchived) return false;
      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations") return false;
      if (projectName === "pmc shop time") return false;
      if (projectName === "pmc test project") return false;
      if (projectName.includes("sandbox")) return false;
      if (projectName.includes("raymond king")) return false;
      const estimator = (p.estimator ?? "").toString().trim();
      if (!estimator) return false;
      if (estimator.toLowerCase() === "todd gilmore") return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });
    
    // Group by project identifier to find duplicates with different customers
    const projectIdentifierMap = new Map();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier).push(project);
    });
    
    // For each project identifier, keep only the most recent customer version
    const dedupedByCustomer = [];
    projectIdentifierMap.forEach((projectList, identifier) => {
      // Group by customer
      const customerMap = new Map();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) {
          customerMap.set(customer, []);
        }
        customerMap.get(customer).push(p);
      });
      
      // If multiple customers, keep only the one with latest dateCreated
      if (customerMap.size > 1) {
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
        
        // Only keep projects from the latest customer
        const selectedProjects = customerMap.get(latestCustomer) || [];
        dedupedByCustomer.push(...selectedProjects);
      } else {
        // Only one customer, keep all
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    // Now aggregate by projectNumber + customer
    const map = new Map();
    dedupedByCustomer.forEach((project) => {
      const number = (project.projectNumber ?? "").toString().trim();
      const customer = (project.customer ?? "").toString().trim();
      const key = `${number}|${customer}`;
      
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...project });
        return;
      }
      // Sum the values
      existing.sales = (existing.sales ?? 0) + (project.sales ?? 0);
      existing.cost = (existing.cost ?? 0) + (project.cost ?? 0);
      existing.hours = (existing.hours ?? 0) + (project.hours ?? 0);
    });
    
    const aggregatedProjects = Array.from(map.values());
    
    // Count by status
    const statusCount = {};
    aggregatedProjects.forEach(p => {
      const status = p.status || 'Unknown';
      statusCount[status] = (statusCount[status] || 0) + 1;
    });
    
    console.log(`\n=== Dashboard Project Counts ===`);
    console.log(`Total aggregated projects: ${aggregatedProjects.length}`);
    console.log(`\nBreakdown by status:`);
    Object.entries(statusCount).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    const inProgress = statusCount['In Progress'] || 0;
    const accepted = statusCount['Accepted'] || 0;
    console.log(`\n"In Progress" + "Accepted" = ${inProgress} + ${accepted} = ${inProgress + accepted}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

countDashboardProjects();
