const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkGiant6582() {
  try {
    // Get ALL documents and filter manually
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    const results = [];
    snapshot.forEach(doc => {
      const jobKey = doc.data().jobKey;
      if (jobKey && jobKey.includes('Giant') && jobKey.includes('6582')) {
        results.push({
          jobKey,
          title: doc.data().title,
        });
      }
    });
    
    console.log(`\nFound ${results.length} documents with "Giant" and "6582" in jobKey:\n`);
    
    // Group by jobKey
    const grouped = {};
    results.forEach(r => {
      if (!grouped[r.jobKey]) {
        grouped[r.jobKey] = [];
      }
      grouped[r.jobKey].push(r.title);
    });
    
    Object.entries(grouped).forEach(([jobKey, titles]) => {
      console.log(`\n${jobKey} (${titles.length} scopes):`);
      titles.slice(0, 5).forEach((title, idx) => {
        console.log(`  ${idx + 1}. "${title}"`);
      });
      if (titles.length > 5) {
        console.log(`  ... and ${titles.length - 5} more`);
      }
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkGiant6582();
