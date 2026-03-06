const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function findKemperProjects() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  console.log('\nSearching for Kemper projects...\n');
  
  const projectsSnapshot = await getDocs(collection(db, 'projects'));
  
  const kemperProjects = [];
  projectsSnapshot.forEach(doc => {
    const data = doc.data();
    if (doc.id.toLowerCase().includes('kemper') || 
        (data.projectName && data.projectName.toLowerCase().includes('kemper'))) {
      kemperProjects.push({
        id: doc.id,
        ...data
      });
    }
  });
  
  console.log(`Found ${kemperProjects.length} Kemper project(s):\n`);
  
  kemperProjects.forEach(project => {
    console.log('JobKey/ID:', project.id);
    console.log('Customer:', project.customer);
    console.log('Project Number:', project.projectNumber);
    console.log('Project Name:', project.projectName);
    
    if (project.scopeOfWork && Array.isArray(project.scopeOfWork)) {
      console.log(`\nScope of Work (${project.scopeOfWork.length} scopes):`);
      
      let totalHours = 0;
      project.scopeOfWork.forEach((scope, index) => {
        console.log(`\n  ${index + 1}. ${scope.title}`);
        console.log(`     Hours: ${scope.hours || 0}`);
        console.log(`     Manpower: ${scope.manpower || 0}`);
        if (scope.startDate || scope.endDate) {
          console.log(`     Dates: ${scope.startDate || 'N/A'} to ${scope.endDate || 'N/A'}`);
        }
        totalHours += scope.hours || 0;
      });
      
      console.log(`\n  Total Hours: ${totalHours}`);
    } else {
      console.log('No scopeOfWork data');
    }
    console.log('\n' + '='.repeat(70) + '\n');
  });
}

findKemperProjects()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
