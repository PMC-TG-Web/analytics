const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function findGiant() {
  console.log(`\nSearching for Giant #6582 in projects collection...`);
  
  const projectsSnapshot = await getDocs(collection(db, 'projects'));
  
  let matchCount = 0;
  const matches = [];
  
  projectsSnapshot.forEach(doc => {
    const data = doc.data();
    const projectName = (data.projectName || '').toLowerCase();
    const projectNumber = (data.projectNumber || '').toString();
    
    // Search for Giant #6582, Giant 6582, or project number 2508 - GI
    if (projectName.includes('giant') && (projectName.includes('6582') || projectNumber.includes('6582'))) {
      matchCount++;
      matches.push({
        jobKey: data.jobKey,
        customer: data.customer,
        projectNumber: data.projectNumber,
        projectName: data.projectName,
        costitems: data.costitems,
        hours: data.hours,
        costType: data.costType
      });
    }
  });
  
  console.log(`\nFound ${matchCount} matching documents\n`);
  
  if (matchCount > 0) {
    // Group by jobKey
    const byJobKey = {};
    matches.forEach(match => {
      const key = match.jobKey || 'NO_JOBKEY';
      if (!byJobKey[key]) {
        byJobKey[key] = [];
      }
      byJobKey[key].push(match);
    });
    
    Object.keys(byJobKey).forEach(jobKey => {
      console.log(`\nJobKey: ${jobKey}`);
      console.log(`Cost items count: ${byJobKey[jobKey].length}`);
      byJobKey[jobKey].slice(0, 5).forEach((item, idx) => {
        console.log(`  ${idx + 1}. ${item.costitems} (${item.costType}) - ${item.hours} hours`);
      });
      if (byJobKey[jobKey].length > 5) {
        console.log(`  ... and ${byJobKey[jobKey].length - 5} more`);
      }
    });
  }
  
  process.exit(0);
}

findGiant().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
