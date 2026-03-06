const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function check() {
  try {
    const snapshot = await getDocs(collection(db, 'projectScopes'));
    
    // Find the scopes that appear in the screenshot
    const problematic = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const title = data.title || '';
      
      // Look for the specific titles from the screenshot showing under Giant
      if (title.includes('1,721 Sq Ft') || 
          title.includes('134 Lf') ||
          title.includes('142 Lf 5') ||
          title.includes('153 Lf 8') ||
          title.includes('16 Each P1') ||
          title.includes('30 Sq Ft 5') ||
          title.includes('47 Lf')) {
        problematic.push({
          jobKey: data.jobKey,
          title: title,
        });
      }
    });
    
    console.log(`Found ${problematic.length} problematic scope documents:\n`);
    
    problematic.forEach(p => {
      console.log(`JobKey: ${p.jobKey}`);
      console.log(`Title: "${p.title}"\n`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

check();
