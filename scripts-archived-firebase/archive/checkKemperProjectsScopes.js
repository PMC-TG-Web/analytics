const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkKemperProjectsScopes() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  console.log('\nSearching for Kemper Equipment projects...\n');
  
  // Query by customer, projectNumber, or projectName
  const customersSnapshot = await getDocs(
    query(collection(db, 'projects'), 
          where('customer', '==', 'Hoover Building Specialists, Inc.'))
  );
  
  const kemperProjects = customersSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(p => p.projectNumber === '2505 - KE' || 
                 (p.projectName && p.projectName.includes('Kemper')));
  
  console.log(`Found ${kemperProjects.length} Kemper project documents:\n`);
  
  // Group by scopeOfWork
  const scopeGroups = {};
  let totalHours = 0;
  
  kemperProjects.forEach(project => {
    const scope = project.scopeOfWork || 'Default Scope';
    if (!scopeGroups[scope]) {
      scopeGroups[scope] = {
        count: 0,
        totalHours: 0,
        projects: []
      };
    }
    scopeGroups[scope].count++;
    scopeGroups[scope].totalHours += project.hours || 0;
    scopeGroups[scope].projects.push({
      id: project.id,
      hours: project.hours || 0,
      status: project.status
    });
    totalHours += project.hours || 0;
  });
  
  console.log('Scope of Work breakdown:\n');
  Object.entries(scopeGroups).forEach(([scopeName, data]) => {
    console.log(`📋 "${scopeName}"`);
    console.log(`   Projects: ${data.count}`);
    console.log(`   Total Hours: ${data.totalHours}`);
    console.log(`   Projects:`);
    data.projects.forEach(p => {
      console.log(`     - ${p.id}: ${p.hours} hrs (${p.status})`);
    });
    console.log('');
  });
  
  console.log(`\nGrand Total Hours: ${totalHours}`);
  console.log(`Total Project Documents: ${kemperProjects.length}`);
}

checkKemperProjectsScopes()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
