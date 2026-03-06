const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function check() {
  try {
    // Look for Washburn Dam scopes since that's visible in the screenshot
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    const washburn = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey?.includes('Washburn') || data.projectName?.includes('Washburn')) {
        washburn.push({
          id: doc.id,
          jobKey: data.jobKey,
          title: data.title,
          description: data.description,
          startDate: data.startDate,
          endDate: data.endDate,
        });
      }
    });
    
    console.log(`Found ${washburn.length} Washburn Dam scopes:\n`);
    
    // Count duplicates
    const titleCount = {};
    washburn.forEach(s => {
      titleCount[s.title] = (titleCount[s.title] || 0) + 1;
    });
    
    const duplicates = Object.entries(titleCount).filter(([_, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log('DUPLICATES FOUND:\n');
      duplicates.forEach(([title, count]) => {
        console.log(`${count}x: "${title}"`);
      });
    }
    
    console.log('\nAll scopes:');
    washburn.forEach((s, idx) => {
      console.log(`${idx + 1}. "${s.title}"`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

check();
