const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function countSchedulingJobs() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    
    const qualifyingStatuses = ["Accepted", "In Progress", "Delayed"];
    const map = new Map();
    
    let totalProjects = 0;
    let filteredOut = 0;
    
    querySnapshot.docs.forEach(doc => {
      const p = doc.data();
      totalProjects++;
      
      // Apply same filters as dashboard
      if (p.projectArchived) {
        filteredOut++;
        return;
      }
      
      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) {
        filteredOut++;
        return;
      }
      
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations" || projectName === "pmc shop time" || 
          projectName === "pmc test project" || projectName.includes("sandbox") || 
          projectName.includes("raymond king")) {
        filteredOut++;
        return;
      }
      
      const estimator = (p.estimator ?? "").toString().trim();
      if (!estimator || estimator.toLowerCase() === "todd gilmore") {
        filteredOut++;
        return;
      }
      
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") {
        filteredOut++;
        return;
      }
      
      // Check if status qualifies
      if (!qualifyingStatuses.includes(p.status || "")) {
        return; // Don't count as filtered, just not in scope
      }
      
      // Create unique key
      const key = `${p.customer ?? ""}|${p.projectNumber ?? ""}|${p.projectName ?? ""}`;
      if (!map.has(key)) {
        map.set(key, {
          customer: p.customer ?? "Unknown",
          projectName: p.projectName ?? "Unnamed",
          projectNumber: p.projectNumber ?? "",
          status: p.status ?? "Unknown",
          totalHours: p.hours ?? 0
        });
      }
    });
    
    console.log(`\n=== Scheduling Table Jobs ===`);
    console.log(`Total projects in database: ${totalProjects}`);
    console.log(`Filtered out by exclusion rules: ${filteredOut}`);
    console.log(`Unique jobs in scheduling table: ${map.size}`);
    console.log(`\nStatuses included: ${qualifyingStatuses.join(", ")}`);
    
    // Show breakdown by status
    const statusCount = {};
    map.forEach(job => {
      statusCount[job.status] = (statusCount[job.status] || 0) + 1;
    });
    
    console.log(`\nBreakdown by status:`);
    Object.entries(statusCount).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

countSchedulingJobs();
