const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkKemperProject() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  const jobKey = "Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment";
  
  console.log(`\nFetching project for: ${jobKey}`);
  
  const projectDoc = await getDoc(doc(db, 'projects', jobKey));
  
  if (!projectDoc.exists()) {
    console.log('Project not found!');
    return;
  }
  
  const projectData = projectDoc.data();
  
  console.log('\nProject Data:');
  console.log('Customer:', projectData.customer);
  console.log('Project Number:', projectData.projectNumber);
  console.log('Project Name:', projectData.projectName);
  console.log('\nScope of Work:');
  
  if (projectData.scopeOfWork && Array.isArray(projectData.scopeOfWork)) {
    console.log(`Found ${projectData.scopeOfWork.length} scopes:\n`);
    
    let totalHours = 0;
    projectData.scopeOfWork.forEach((scope, index) => {
      console.log(`${index + 1}. ${scope.title}`);
      console.log(`   Hours: ${scope.hours || 0}`);
      console.log(`   Manpower: ${scope.manpower || 0}`);
      if (scope.startDate || scope.endDate) {
        console.log(`   Dates: ${scope.startDate || 'N/A'} to ${scope.endDate || 'N/A'}`);
      }
      console.log('');
      totalHours += scope.hours || 0;
    });
    
    console.log(`Total Hours: ${totalHours}`);
  } else {
    console.log('No scopeOfWork array found or it is empty');
  }
}

checkKemperProject()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
