const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function check() {
  try {
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    const results = [];
    snapshot.forEach(doc => {
      const jobKey = doc.data().jobKey;
      if (jobKey && jobKey === 'Ames Construction, Inc.~2508 - GI~Giant #6582') {
        results.push(doc.data().title);
      }
    });
    
    console.log(`\nAmes Construction + Giant #6582: ${results.length} total documents\n`);
    
    // Check for duplicates
    const titleCount = {};
    results.forEach(title => {
      titleCount[title] = (titleCount[title] || 0) + 1;
    });
    
    const duplicates = Object.entries(titleCount).filter(([_, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log('DUPLICATES FOUND:\n');
      duplicates.forEach(([title, count]) => {
        console.log(`${count}x: "${title}"`);
      });
      console.log('\n\nAll scopes:');
      results.forEach((title, idx) => {
        console.log(`${idx + 1}. "${title}"`);
      });
    } else {
      console.log('No duplicates - all scopes are unique!\n');
      console.log('All scopes:');
      results.forEach((title, idx) => {
        console.log(`${idx + 1}. "${title}"`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

check();
