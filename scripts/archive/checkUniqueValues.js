const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

(async () => {
  const snapshot = await getDocs(collection(db, 'projects'));
  const stageNames = new Set();
  const statuses = new Set();
  
  snapshot.docs.forEach(d => {
    const data = d.data();
    if (data.stagename) stageNames.add(data.stagename);
    if (data.status) statuses.add(data.status);
  });
  
  console.log('Unique Stage Names:');
  [...stageNames].sort().forEach(s => console.log(`  - "${s}"`));
  
  console.log('\nUnique Statuses:');
  [...statuses].sort().forEach(s => console.log(`  - "${s}"`));
})();
