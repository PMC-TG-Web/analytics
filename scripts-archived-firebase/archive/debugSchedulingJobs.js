const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkSchedulingJobs() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    const projects = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`Total projects in database: ${projects.length}`);
    
    const qualifyingStatuses = ["Accepted", "In Progress"];
    
    // Apply all filters
    const filtered = projects.filter(p => {
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
      
      // Check status
      return qualifyingStatuses.includes(p.status || "");
    });
    
    console.log(`\nProjects after filters with Accepted/In Progress status: ${filtered.length}`);
    
    // Create unique job keys as the page does
    const map = new Map();
    filtered.forEach((p) => {
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
    
    console.log(`Unique jobs (by customer|projectNumber|projectName): ${map.size}`);
    
    const statusBreakdown = {};
    map.forEach(job => {
      statusBreakdown[job.status] = (statusBreakdown[job.status] || 0) + 1;
    });
    
    console.log('\nBreakdown by status:');
    Object.entries(statusBreakdown).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    console.log('\nFirst 10 jobs:');
    Array.from(map.values()).slice(0, 10).forEach((job, i) => {
      console.log(`  ${i + 1}. ${job.customer} - ${job.projectName} (${job.status})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSchedulingJobs();
