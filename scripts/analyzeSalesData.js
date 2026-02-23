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

async function analyzeSalesData() {
  console.log('====== Analyzing Sales Data in Database ======\n');
  
  try {
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    const projects = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    console.log(`Total projects in database: ${projects.length}\n`);
    
    // Filter out excluded projects (same as KPI page does)
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
    
    console.log(`Projects after filtering: ${filteredProjects.length}\n`);
    
    // Group by status
    const statusGroups = {};
    filteredProjects.forEach(p => {
      const status = (p.status || "Unknown").trim();
      if (!statusGroups[status]) {
        statusGroups[status] = { count: 0, totalSales: 0, withSales: 0, projects: [] };
      }
      statusGroups[status].count++;
      const sales = Number(p.sales || 0);
      statusGroups[status].totalSales += sales;
      if (sales > 0) {
        statusGroups[status].withSales++;
        statusGroups[status].projects.push({
          name: p.projectName || p.projectNumber,
          customer: p.customer,
          sales: sales,
          dateCreated: p.dateCreated,
          dateUpdated: p.dateUpdated
        });
      }
    });
    
    console.log('====== Sales by Status ======\n');
    Object.entries(statusGroups)
      .sort((a, b) => b[1].totalSales - a[1].totalSales)
      .forEach(([status, data]) => {
        console.log(`${status}:`);
        console.log(`  Projects: ${data.count}`);
        console.log(`  Projects with sales > 0: ${data.withSales}`);
        console.log(`  Total Sales: $${data.totalSales.toLocaleString()}`);
        console.log('');
      });
    
    // Show sample Bid Submitted projects with dates
    const bidSubmitted = statusGroups["Bid Submitted"]?.projects || [];
    if (bidSubmitted.length > 0) {
      console.log('\n====== Sample Bid Submitted Projects (first 10) ======\n');
      bidSubmitted.slice(0, 10).forEach(p => {
        const dateCreated = parseDateValue(p.dateCreated);
        const dateUpdated = parseDateValue(p.dateUpdated);
        const createdStr = dateCreated ? dateCreated.toISOString().split('T')[0] : 'N/A';
        const updatedStr = dateUpdated ? dateUpdated.toISOString().split('T')[0] : 'N/A';
        
        console.log(`${p.name} (${p.customer})`);
        console.log(`  Sales: $${p.sales.toLocaleString()}`);
        console.log(`  Date Created: ${createdStr}`);
        console.log(`  Date Updated: ${updatedStr}`);
        console.log('');
      });
    }
    
    // Check for Estimating status
    const estimating = statusGroups["Estimating"]?.projects || [];
    if (estimating.length > 0) {
      console.log('\n====== Sample Estimating Projects (first 10) ======\n');
      estimating.slice(0, 10).forEach(p => {
        const dateCreated = parseDateValue(p.dateCreated);
        const dateUpdated = parseDateValue(p.dateUpdated);
        const createdStr = dateCreated ? dateCreated.toISOString().split('T')[0] : 'N/A';
        const updatedStr = dateUpdated ? dateUpdated.toISOString().split('T')[0] : 'N/A';
        
        console.log(`${p.name} (${p.customer})`);
        console.log(`  Sales: $${p.sales.toLocaleString()}`);
        console.log(`  Date Created: ${createdStr}`);
        console.log(`  Date Updated: ${updatedStr}`);
        console.log('');
      });
    }
    
    // Check date distribution for Bid Submitted
    if (bidSubmitted.length > 0) {
      const dateDistribution = {};
      bidSubmitted.forEach(p => {
        const dateCreated = parseDateValue(p.dateCreated);
        if (dateCreated) {
          const year = dateCreated.getFullYear();
          const month = dateCreated.getMonth() + 1;
          const key = `${year}-${String(month).padStart(2, '0')}`;
          if (!dateDistribution[key]) {
            dateDistribution[key] = { count: 0, sales: 0 };
          }
          dateDistribution[key].count++;
          dateDistribution[key].sales += p.sales;
        }
      });
      
      console.log('\n====== Bid Submitted Projects by Month (dateCreated) ======\n');
      Object.entries(dateDistribution)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([month, data]) => {
          console.log(`${month}: ${data.count} projects, $${data.sales.toLocaleString()}`);
        });
    }
    
    // Grand total
    const grandTotal = filteredProjects.reduce((sum, p) => sum + (Number(p.sales) || 0), 0);
    const projectsWithSales = filteredProjects.filter(p => (Number(p.sales) || 0) > 0).length;
    
    console.log('\n====== Grand Total ======');
    console.log(`Projects with sales > 0: ${projectsWithSales}`);
    console.log(`Total Sales (all statuses): $${grandTotal.toLocaleString()}`);
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

analyzeSalesData();
