const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkKemperScopes() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  
  const jobKey = 'Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment';

  try {
    console.log(`\nFetching scopes for: ${jobKey}\n`);
    
    const q = query(collection(db, 'projectScopes'), where('jobKey', '==', jobKey));
    const querySnapshot = await getDocs(q);
    
    console.log(`Found ${querySnapshot.size} scopes:\n`);
    
    let totalHours = 0;
    querySnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const hours = data.hours || 0;
      const manpower = data.manpower || 0;
      const title = data.title || 'Untitled';
      const startDate = data.startDate || 'No start';
      const endDate = data.endDate || 'No end';
      
      totalHours += hours;
      
      console.log(`- ${title}`);
      console.log(`  Hours: ${hours}`);
      console.log(`  Manpower: ${manpower}`);
      console.log(`  Dates: ${startDate} to ${endDate}`);
      console.log(`  ID: ${doc.id}\n`);
    });
    
    console.log(`Total Hours across all scopes: ${totalHours}\n`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkKemperScopes();
