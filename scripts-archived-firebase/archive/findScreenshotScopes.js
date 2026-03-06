const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function check() {
  try {
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    // Search for the scopes shown in the screenshot
    const results = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const title = data.title || '';
      
      // Look for titles that match the screenshot
      if (title.includes('1,721 Sq Ft') || title.includes('134 Lf') || title.includes('142 Lf 5')) {
        results.push({
          jobKey: data.jobKey,
          title: title,
        });
      }
    });
    
    console.log(`Found ${results.length} scopes matching screenshot data:\n`);
    
    // Group by jobKey
    const byJob = {};
    results.forEach(r => {
      if (!byJob[r.jobKey]) byJob[r.jobKey] = [];
      byJob[r.jobKey].push(r.title);
    });
    
    Object.entries(byJob).forEach(([jobKey, titles]) => {
      console.log(`\n${jobKey}:`);
      titles.forEach(t => console.log(`  - "${t}"`));
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

check();
