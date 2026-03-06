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

function parseDateValue(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
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

async function checkBidSubmittedDates() {
  console.log('====== Checking Bid Submitted Projects Dates ======\n');
  
  try {
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    const projects = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Filter to only Bid Submitted or Estimating projects
    const bidSubmittedProjects = projects.filter(p => {
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
      
      const status = (p.status || "").trim();
      return status === "Bid Submitted" || status === "Estimating";
    });
    
    console.log(`Total Bid Submitted/Estimating projects: ${bidSubmittedProjects.length}\n`);
    
    // Group by month using dateCreated
    const byMonth = {};
    bidSubmittedProjects.forEach(p => {
      const dateCreated = parseDateValue(p.dateCreated);
      const dateUpdated = parseDateValue(p.dateUpdated);
      const projectDate = dateCreated || dateUpdated;
      
      if (projectDate) {
        const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
        if (!byMonth[monthKey]) {
          byMonth[monthKey] = { count: 0, sales: 0, projects: [] };
        }
        byMonth[monthKey].count++;
        byMonth[monthKey].sales += (p.sales || 0);
        byMonth[monthKey].projects.push({
          name: p.projectName || p.projectNumber,
          customer: p.customer,
          sales: p.sales,
          status: p.status,
          dateCreated: dateCreated ? dateCreated.toISOString().split('T')[0] : 'N/A',
          dateUpdated: dateUpdated ? dateUpdated.toISOString().split('T')[0] : 'N/A'
        });
      }
    });
    
    // Sort months and display
    const sortedMonths = Object.keys(byMonth).sort();
    console.log('Sales by Month (using dateCreated/dateUpdated):\n');
    sortedMonths.forEach(month => {
      const data = byMonth[month];
      console.log(`${month}: ${data.count} projects, $${data.sales.toLocaleString()} total sales`);
    });
    
    // Show January 2026 projects if they exist
    if (byMonth['2026-01']) {
      console.log('\n====== January 2026 Bid Submitted Projects ======');
      byMonth['2026-01'].projects.forEach(p => {
        console.log(`  ${p.name} (${p.customer})`);
        console.log(`    Sales: $${(p.sales || 0).toLocaleString()}`);
        console.log(`    Status: ${p.status}`);
        console.log(`    Date Created: ${p.dateCreated}`);
        console.log(`    Date Updated: ${p.dateUpdated}`);
        console.log('');
      });
    } else {
      console.log('\n⚠️  No projects found for January 2026 using dateCreated/dateUpdated\n');
      
      // Check if there are any Jan 2026 projects at all
      const jan2026Projects = bidSubmittedProjects.filter(p => {
        if (!p.dateCreated && !p.dateUpdated) return false;
        const dateCreated = parseDateValue(p.dateCreated);
        const dateUpdated = parseDateValue(p.dateUpdated);
        return (dateCreated && dateCreated.getFullYear() === 2026 && dateCreated.getMonth() === 0) ||
               (dateUpdated && dateUpdated.getFullYear() === 2026 && dateUpdated.getMonth() === 0);
      });
      
      console.log(`Projects with Jan 2026 in dateCreated or dateUpdated: ${jan2026Projects.length}`);
    }
    
    // Check what other date fields exist
    console.log('\n====== Available Date Fields ======');
    const sampleProject = bidSubmittedProjects[0];
    if (sampleProject) {
      console.log('Sample project fields:');
      Object.keys(sampleProject).filter(k => k.toLowerCase().includes('date')).forEach(field => {
        console.log(`  ${field}: ${sampleProject[field]}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

checkBidSubmittedDates();
