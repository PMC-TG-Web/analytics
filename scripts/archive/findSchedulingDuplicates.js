const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function findDuplicates() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    const projects = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const qualifyingStatuses = ["Accepted", "In Progress", "Delayed"];
    
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
      
      // Check status
      return qualifyingStatuses.includes(p.status || "");
    });
    
    // Group by project identifier
    const projectIdentifierMap = new Map();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier).push(project);
    });
    
    // Find duplicates with different customers
    console.log(`\n=== Checking for Duplicate Projects in Scheduling Statuses ===`);
    console.log(`Total projects after filters: ${activeProjects.length}`);
    console.log(`Unique project identifiers: ${projectIdentifierMap.size}\n`);
    
    let duplicatesFound = 0;
    projectIdentifierMap.forEach((projectList, identifier) => {
      if (projectList.length > 1) {
        // Group by customer
        const customerMap = new Map();
        projectList.forEach(p => {
          const customer = (p.customer ?? "").toString().trim();
          if (!customerMap.has(customer)) {
            customerMap.set(customer, []);
          }
          customerMap.get(customer).push(p);
        });
        
        if (customerMap.size > 1) {
          duplicatesFound++;
          console.log(`\nDUPLICATE FOUND: "${identifier}"`);
          console.log(`  Has ${customerMap.size} different customers:`);
          customerMap.forEach((projs, customer) => {
            console.log(`    - Customer: "${customer}" (${projs.length} rows)`);
            projs.forEach(p => {
              console.log(`        Status: ${p.status}, Created: ${p.dateCreated}, Number: ${p.projectNumber}`);
            });
          });
        }
      }
    });
    
    if (duplicatesFound === 0) {
      console.log('✓ No duplicates found! Each project identifier has only one customer.');
    } else {
      console.log(`\n⚠ Found ${duplicatesFound} project(s) with multiple customers`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

findDuplicates();
