const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyBc6lJLXi7AzMTBjyQ-mRmVmvkE6nI6RlI",
  authDomain: "preconstruction-portal.firebaseapp.com",
  projectId: "preconstruction-portal",
  storageBucket: "preconstruction-portal.firebasestorage.app",
  messagingSenderId: "100296374712",
  appId: "1:100296374712:web:e1d8fed4eb9d6ed46e0e20"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkKPIChartData() {
  console.log('====== Checking KPI Chart Data ======\n');
  
  try {
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    const projects = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`Total projects: ${projects.length}\n`);
    
    // Filter projects like the KPI page does
    const filteredProjects = projects.filter((p) => {
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
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      
      return true;
    });
    
    console.log(`Filtered projects (not archived, not excluded): ${filteredProjects.length}\n`);
    
    // Check Bid Submitted / Estimating projects
    const bidSubmittedProjects = filteredProjects.filter(p => {
      const status = (p.status || "").trim();
      return status === "Bid Submitted" || status === "Estimating";
    });
    
    console.log(`Projects with "Bid Submitted" or "Estimating" status: ${bidSubmittedProjects.length}`);
    
    if (bidSubmittedProjects.length > 0) {
      const bidSubmittedWithHours = bidSubmittedProjects.filter(p => (p.hours || 0) > 0);
      console.log(`  - With hours > 0: ${bidSubmittedWithHours.length}`);
      
      const totalBidHours = bidSubmittedProjects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
      console.log(`  - Total hours: ${totalBidHours.toLocaleString()}`);
      
      if (bidSubmittedWithHours.length > 0) {
        console.log('\n  Sample Bid Submitted projects with hours:');
        bidSubmittedWithHours.slice(0, 5).forEach(p => {
          console.log(`    - ${p.projectName || p.projectNumber} (${p.customer}): ${p.hours} hrs, status: ${p.status}`);
        });
      }
    }
    
    // Check In Progress / Accepted / Complete projects
    const qualifyingStatuses = ["In Progress", "Accepted", "Complete"];
    const inProgressProjects = filteredProjects.filter(p => {
      const status = (p.status || "").trim();
      return qualifyingStatuses.includes(status);
    });
    
    console.log(`\nProjects with "In Progress", "Accepted", or "Complete" status: ${inProgressProjects.length}`);
    
    if (inProgressProjects.length > 0) {
      const inProgressWithHours = inProgressProjects.filter(p => (p.hours || 0) > 0);
      console.log(`  - With hours > 0: ${inProgressWithHours.length}`);
      
      const totalInProgressHours = inProgressProjects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
      console.log(`  - Total hours: ${totalInProgressHours.toLocaleString()}`);
      
      if (inProgressWithHours.length > 0) {
        console.log('\n  Sample In Progress projects with hours:');
        inProgressWithHours.slice(0, 5).forEach(p => {
          console.log(`    - ${p.projectName || p.projectNumber} (${p.customer}): ${p.hours} hrs, status: ${p.status}`);
        });
      }
    }
    
    // Check unique statuses
    const statusCounts = {};
    filteredProjects.forEach(p => {
      const status = (p.status || "Unknown").trim();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    console.log('\n====== Status Distribution ======');
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`${status}: ${count}`);
      });
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

checkKPIChartData();
