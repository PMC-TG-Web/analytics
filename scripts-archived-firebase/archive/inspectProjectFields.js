const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, limit, query } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectProjects() {
  try {
    const q = query(collection(db, 'projects'), limit(3));
    const snapshot = await getDocs(q);
    
    if (snapshot.docs.length === 0) {
      console.log('No projects found');
      return;
    }

    snapshot.docs.forEach((doc, idx) => {
      console.log(`\n========== Project ${idx + 1} ==========`);
      const data = doc.data();
      console.log('All fields:');
      Object.keys(data).forEach(key => {
        const value = data[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          console.log(`  ${key}: ${value}`);
        } else {
          console.log(`  ${key}: [${typeof value}]`);
        }
      });
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit(0);
  }
}

inspectProjects();
