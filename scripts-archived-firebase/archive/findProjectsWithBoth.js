const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where, limit } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function findProjectWithBoth() {
  try {
    console.log("Finding a project with both scopes and cost items...\n");

    // Get all jobKeys from scopes
    const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
    const scopeJobKeys = new Set();
    scopesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey) {
        scopeJobKeys.add(data.jobKey);
      }
    });
    
    console.log(`Found ${scopeJobKeys.size} unique jobKeys with scopes`);
    
    // Get all jobKeys from projects
    const projectsSnapshot = await getDocs(collection(db, "projects"));
    const projectJobKeys = new Set();
    const projectsByJobKey = {};
    
    projectsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey) {
        projectJobKeys.add(data.jobKey);
        if (!projectsByJobKey[data.jobKey]) {
          projectsByJobKey[data.jobKey] = [];
        }
        projectsByJobKey[data.jobKey].push({
          costitems: data.costitems,
          sales: data.sales,
          cost: data.cost,
          hours: data.hours
        });
      }
    });
    
    console.log(`Found ${projectJobKeys.size} unique jobKeys with cost items`);
    
    // Find jobKeys that have both
    const commonJobKeys = Array.from(scopeJobKeys).filter(jk => projectJobKeys.has(jk));
    
    console.log(`\nFound ${commonJobKeys.length} jobKeys with BOTH scopes and cost items:\n`);
    
    commonJobKeys.slice(0, 10).forEach(jk => {
      const costItemCount = projectsByJobKey[jk].length;
      console.log(`\n${jk}`);
      console.log(`  Cost Items: ${costItemCount}`);
      console.log(`  Sample cost items:`);
      projectsByJobKey[jk].slice(0, 3).forEach(item => {
        console.log(`    - ${item.costitems} (Sales: $${item.sales || 0}, Cost: $${item.cost || 0}, Hours: ${item.hours || 0})`);
      });
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

findProjectWithBoth();
