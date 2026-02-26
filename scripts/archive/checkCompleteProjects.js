const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

(async () => {
  console.log('Fetching all projects...\n');
  const snapshot = await getDocs(collection(db, 'projects'));
  
  const allProjects = snapshot.docs.map(d => d.data());
  
  // Filter for Complete status
  const completeProjects = allProjects.filter(p => {
    const status = (p.status || '').toString().trim();
    return status === 'Complete';
  });
  
  console.log(`Total projects in Firestore: ${allProjects.length}`);
  console.log(`Projects with status = "Complete": ${completeProjects.length}\n`);
  
  // Apply dashboard filters
  const filteredComplete = completeProjects.filter(p => {
    if (p.projectArchived) return false;
    
    const customer = (p.customer ?? "").toString().toLowerCase();
    if (customer.includes("sop inc")) return false;
    const projectName = (p.projectName ?? "").toString().toLowerCase();
    if (projectName === "pmc operations") return false;
    if (projectName === "pmc shop time") return false;
    if (projectName === "pmc test project") return false;
    if (projectName.includes("sandbox")) return false;
    if (projectName.includes("raymond king")) return false;
    if (projectName === "alexander drive addition latest") return false;
    const estimator = (p.estimator ?? "").toString().trim();
    if (!estimator) return false;
    if (estimator.toLowerCase() === "todd gilmore") return false;
    const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
    if (projectNumber === "701 poplar church rd") return false;
    return true;
  });
  
  console.log(`After dashboard filters: ${filteredComplete.length} Complete projects\n`);
  
  // Calculate total sales
  const totalSales = filteredComplete.reduce((sum, p) => sum + (p.sales ?? 0), 0);
  console.log(`Total Sales from Complete projects: $${totalSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n`);
  
  // Group by project key (projectNumber + customer)
  const getProjectKey = (project) => {
    const number = (project.projectNumber ?? "").toString().trim();
    const customer = (project.customer ?? "").toString().trim();
    return `${number}|${customer}` || `__noKey__${Math.random()}`;
  };
  
  const keyGroupMap = new Map();
  filteredComplete.forEach((project) => {
    const key = getProjectKey(project);
    if (!keyGroupMap.has(key)) {
      keyGroupMap.set(key, []);
    }
    keyGroupMap.get(key).push(project);
  });
  
  console.log(`Unique project keys (projectNumber + customer): ${keyGroupMap.size}\n`);
  
  // Aggregate by key
  const aggregated = [];
  keyGroupMap.forEach((projects, key) => {
    const sortedProjects = projects.sort((a, b) => {
      const nameA = (a.projectName ?? "").toString().toLowerCase();
      const nameB = (b.projectName ?? "").toString().toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    const baseProject = { ...sortedProjects[0] };
    baseProject.sales = sortedProjects.reduce((sum, p) => sum + (p.sales ?? 0), 0);
    baseProject.lineItemCount = sortedProjects.length;
    
    aggregated.push(baseProject);
  });
  
  const aggregatedSales = aggregated.reduce((sum, p) => sum + (p.sales ?? 0), 0);
  console.log(`Aggregated Sales (after grouping by projectNumber+customer): $${aggregatedSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n`);
  
  // Show top 20 projects
  console.log('Top 20 Complete projects by sales:');
  console.log('='.repeat(120));
  aggregated
    .sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0))
    .slice(0, 20)
    .forEach((p, i) => {
      console.log(`${i + 1}. ${p.customer || 'N/A'} - ${p.projectName || 'N/A'} (${p.projectNumber || 'N/A'})`);
      console.log(`   Sales: $${(p.sales || 0).toLocaleString()} | Line Items: ${p.lineItemCount}`);
    });
  
  console.log('\n' + '='.repeat(120));
  console.log(`TOTAL AGGREGATED SALES: $${aggregatedSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
})();
