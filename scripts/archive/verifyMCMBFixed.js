const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function check() {
  try {
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    const mcmb = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey?.includes('Memory Care') || data.projectName?.includes('Memory Care')) {
        mcmb.push({
          id: doc.id,
          title: data.title,
        });
      }
    });
    
    console.log(`Memory Care Meditation Building: ${mcmb.length} scopes\n`);
    
    // Check for duplicates
    const titleCount = {};
    mcmb.forEach(s => {
      titleCount[s.title] = (titleCount[s.title] || 0) + 1;
    });
    
    const duplicates = Object.entries(titleCount).filter(([_, count]) => count > 1);
    
    if (duplicates.length > 0) {
      console.log('❌ DUPLICATES STILL FOUND:\n');
      duplicates.forEach(([title, count]) => {
        console.log(`${count}x: "${title}"`);
      });
    } else {
      console.log('✅ No duplicates - all scopes are unique!\n');
      mcmb.forEach((s, idx) => {
        console.log(`${idx + 1}. "${s.title}"`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

check();
