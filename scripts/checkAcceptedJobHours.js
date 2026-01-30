const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkAcceptedJobs() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    const projects = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
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
      
      return qualifyingStatuses.includes(p.status || "");
    });
    
    // Group by unique key and check hours
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
      } else {
        // If we see the same key again, accumulate hours
        const existing = map.get(key);
        existing.totalHours += (p.hours ?? 0);
      }
    });
    
    console.log('\n=== Jobs by Status with Hours ===');
    
    const acceptedJobs = [];
    const inProgressJobs = [];
    
    map.forEach(job => {
      if (job.status === 'Accepted') {
        acceptedJobs.push(job);
      } else if (job.status === 'In Progress') {
        inProgressJobs.push(job);
      }
    });
    
    console.log(`\nAccepted Jobs (${acceptedJobs.length}):`);
    acceptedJobs.forEach(job => {
      console.log(`  - ${job.customer} | ${job.projectName} | Hours: ${job.totalHours}`);
    });
    
    console.log(`\nIn Progress with 0 hours:`);
    inProgressJobs.filter(j => j.totalHours === 0).forEach(job => {
      console.log(`  - ${job.customer} | ${job.projectName} | Hours: ${job.totalHours}`);
    });
    
    const jobsWithHours = Array.from(map.values()).filter(j => j.totalHours > 0);
    console.log(`\n✓ Total jobs with hours > 0: ${jobsWithHours.length}`);
    console.log(`  - In Progress: ${jobsWithHours.filter(j => j.status === 'In Progress').length}`);
    console.log(`  - Accepted: ${jobsWithHours.filter(j => j.status === 'Accepted').length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAcceptedJobs();
