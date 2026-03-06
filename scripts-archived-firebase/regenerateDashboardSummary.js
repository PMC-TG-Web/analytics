const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function isExcludedFromDashboard(project) {
  if (project.projectArchived) return true;
  
  const status = (project.status || "").toString().toLowerCase().trim();
  if (status === "invitations" || status === "to do" || status === "todo" || status === "to-do") return true;

  const customer = (project.customer ?? "").toString().toLowerCase();
  if (customer.includes("sop inc")) return true;

  const projectName = (project.projectName ?? "").toString().toLowerCase();
  const excludedNames = [
    "pmc operations",
    "pmc shop time",
    "pmc test project"
  ];
  if (excludedNames.includes(projectName)) return true;

  return false;
}

function getProjectKey(project) {
  const customer = (project.customer ?? "").toString().trim();
  const number = (project.projectNumber ?? "").toString().trim();
  const name = (project.projectName ?? "").toString().trim();
  return `${customer}~${number}~${name}`;
}

async function regenerateDashboardSummary() {
  console.log('Fetching all projects...');
  const snapshot = await getDocs(collection(db, 'projects'));
  const allProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  console.log(`Total projects: ${allProjects.length}`);
  
  // Filter out excluded projects
  const projects = allProjects.filter(p => !isExcludedFromDashboard(p));
  console.log(`After exclusions: ${projects.length}`);
  
  // Deduplicate and aggregate
  const projectIdentifierMap = new Map();
  projects.forEach((project) => {
    const identifier = (project.projectNumber || project.projectName || "").toString().trim();
    if (!identifier) return;
    
    if (!projectIdentifierMap.has(identifier)) {
      projectIdentifierMap.set(identifier, []);
    }
    projectIdentifierMap.get(identifier).push(project);
  });
  
  const dedupedByCustomer = [];
  projectIdentifierMap.forEach((projectList) => {
    const customerMap = new Map();
    projectList.forEach(p => {
      const customer = (p.customer ?? "").toString().trim();
      if (!customerMap.has(customer)) {
        customerMap.set(customer, []);
      }
      customerMap.get(customer).push(p);
    });
    
    if (customerMap.size > 1) {
      const priorityStatuses = ["Accepted", "In Progress", "Complete"];
      let selectedProjects = [];
      let foundPriority = false;
      
      customerMap.forEach((projs) => {
        const hasPriority = projs.some(p => priorityStatuses.includes(p.status || ""));
        if (hasPriority && !foundPriority) {
          selectedProjects = projs;
          foundPriority = true;
        }
      });
      
      if (!foundPriority) {
        let latestProjs = [];
        let latestDate = null;
        
        customerMap.forEach((projs) => {
          const dates = projs.map(p => new Date(p.dateCreated || 0));
          const maxDate = new Date(Math.max(...dates));
          if (!latestDate || maxDate > latestDate) {
            latestDate = maxDate;
            latestProjs = projs;
          }
        });
        selectedProjects = latestProjs;
      }
      dedupedByCustomer.push(...selectedProjects);
    } else {
      projectList.forEach(p => dedupedByCustomer.push(p));
    }
  });
  
  console.log(`After customer dedup: ${dedupedByCustomer.length} line items`);
  
  // Aggregate by project key
  const keyGroupMap = new Map();
  dedupedByCustomer.forEach((project) => {
    const key = getProjectKey(project);
    if (!keyGroupMap.has(key)) {
      keyGroupMap.set(key, []);
    }
    keyGroupMap.get(key).push(project);
  });
  
  const aggregatedProjects = [];
  keyGroupMap.forEach((groupProjects) => {
    const baseProject = { ...groupProjects[0] };
    baseProject.sales = groupProjects.reduce((sum, p) => sum + (Number(p.sales) || 0), 0);
    baseProject.cost = groupProjects.reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
    baseProject.hours = groupProjects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
    aggregatedProjects.push(baseProject);
  });
  
  console.log(`After aggregation: ${aggregatedProjects.length} unique projects`);
  
  // Calculate labor breakdown from dedupedByCustomer (BEFORE aggregation) to preserve individual line item PMC groups
  const laborBreakdown = {};
  dedupedByCustomer.forEach(p => {
    if (p.projectArchived) return; // Skip archived projects
    const status = p.status || 'Unknown';
    if (status === 'Bid Submitted' && p.pmcGroup) {
      const group = p.pmcGroup.toLowerCase();
      laborBreakdown[group] = (laborBreakdown[group] || 0) + (Number(p.hours) || 0);
    }
  });
  
  // Calculate status groups from aggregated projects (for sales, cost, hours, count)
  const statusGroups = {};
  aggregatedProjects.forEach(p => {
    const status = p.status || 'Unknown';
    if (!statusGroups[status]) {
      statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0, laborByGroup: {} };
    }
    
    statusGroups[status].sales += (Number(p.sales) || 0);
    statusGroups[status].cost += (Number(p.cost) || 0);
    statusGroups[status].hours += (Number(p.hours) || 0);
    statusGroups[status].count += 1;
  });
  
  // Populate laborByGroup for each status from dedupedByCustomer (line items)
  dedupedByCustomer.forEach(p => {
    if (p.projectArchived) return; // Skip archived projects
    const status = p.status || 'Unknown';
    if (!statusGroups[status]) return;
    
    const pmcGroup = p.pmcGroup || 'Unassigned';
    const hours = Number(p.hours) || 0;
    
    if (!statusGroups[status].laborByGroup[pmcGroup]) {
      statusGroups[status].laborByGroup[pmcGroup] = 0;
    }
    statusGroups[status].laborByGroup[pmcGroup] += hours;
  });
  
  // Calculate totals
  const totalSales = aggregatedProjects.reduce((sum, p) => sum + (Number(p.sales) || 0), 0);
  const totalCost = aggregatedProjects.reduce((sum, p) => sum + (Number(p.cost) || 0), 0);
  const totalHours = aggregatedProjects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  
  console.log(`\nSummary:`);
  console.log(`Total Sales: $${totalSales.toLocaleString()}`);
  console.log(`Total Cost: $${totalCost.toLocaleString()}`);
  console.log(`Total Hours: ${totalHours.toLocaleString()}`);
  
  // Calculate contractors
  const contractors = {};
  aggregatedProjects.forEach(p => {
    if (p.projectArchived) return; // Skip archived projects
    const customer = p.customer || 'Unknown';
    const status = p.status || 'Unknown';
    const sales = Number(p.sales) || 0;
    const cost = Number(p.cost) || 0;
    const hours = Number(p.hours) || 0;
    
    if (!contractors[customer]) {
      contractors[customer] = {
        sales: 0,
        cost: 0,
        hours: 0,
        count: 0,
        byStatus: {}
      };
    }
    
    contractors[customer].sales += sales;
    contractors[customer].cost += cost;
    contractors[customer].hours += hours;
    contractors[customer].count += 1;
    
    if (!contractors[customer].byStatus[status]) {
      contractors[customer].byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
    }
    contractors[customer].byStatus[status].sales += sales;
    contractors[customer].byStatus[status].cost += cost;
    contractors[customer].byStatus[status].hours += hours;
    contractors[customer].byStatus[status].count += 1;
  });
  
  console.log(`Contractors: ${Object.keys(contractors).length}`);
  
  // Calculate PM hours from dedupedByCustomer (only Bid Submitted status)
  const pmcGroupHours = {};
  dedupedByCustomer.forEach(p => {
    if (p.projectArchived) return; // Skip archived projects
    const status = p.status || '';
    if (status !== 'Bid Submitted') return;
    
    const groupName = (p.pmcGroup || '').toString().trim();
    const normalized = groupName.toLowerCase();
    
    // Only match PM-related groups
    if (!normalized || !(normalized.startsWith('pm ') || normalized === 'pm' || normalized.startsWith('pm-'))) return;
    
    const hours = Number(p.hours) || 0;
    const displayName = p.pmcGroup || 'PM (Unassigned)';
    pmcGroupHours[displayName] = (pmcGroupHours[displayName] || 0) + hours;
  });
  
  const totalPMHours = Object.values(pmcGroupHours).reduce((sum, h) => sum + h, 0);
  console.log(`PM Hours (Bid Submitted): ${totalPMHours.toLocaleString()}`);
  
  // Save to Firestore
  const summaryDoc = {
    statusGroups,
    laborBreakdown,
    contractors,
    pmcGroupHours,
    totalSales,
    totalCost,
    totalHours,
    lastUpdated: new Date().toISOString()
  };
  
  const summaryRef = doc(db, 'metadata', 'dashboard_summary');
  await setDoc(summaryRef, summaryDoc);
  
  console.log('\nDashboard summary saved to Firestore!');
  process.exit(0);
}

regenerateDashboardSummary().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
