const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function searchAllKemperScopes() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  console.log('\nSearching ALL projectScopes for Kemper-related entries...\n');
  
  const scopesSnapshot = await getDocs(collection(db, 'projectScopes'));
  
  const kemperScopes = [];
  scopesSnapshot.forEach(doc => {
    const data = doc.data();
    if (doc.id.toLowerCase().includes('kemper') || 
        (data.jobKey && data.jobKey.toLowerCase().includes('kemper')) ||
        (data.title && data.title.toLowerCase().includes('kemper'))) {
      kemperScopes.push({
        id: doc.id,
        ...data
      });
    }
  });
  
  console.log(`Found ${kemperScopes.length} Kemper-related scope(s):\n`);
  
  let totalHours = 0;
  kemperScopes.forEach((scope, index) => {
    console.log(`${index + 1}. ${scope.title}`);
    console.log(`   JobKey: ${scope.jobKey}`);
    console.log(`   Hours: ${scope.hours || 0}`);
    console.log(`   Manpower: ${scope.manpower || 0}`);
    if (scope.startDate || scope.endDate) {
      console.log(`   Dates: ${scope.startDate || 'N/A'} to ${scope.endDate || 'N/A'}`);
    }
    console.log(`   ID: ${scope.id}`);
    console.log('');
    totalHours += scope.hours || 0;
  });
  
  console.log(`Total stored hours: ${totalHours}`);
}

searchAllKemperScopes()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
