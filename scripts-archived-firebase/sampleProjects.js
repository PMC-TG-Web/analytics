const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, limit } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/firebaseConfig.json')));
const app = initializeApp(cfg);
const db = getFirestore(app);

(async () => {
  const snapshot = await getDocs(query(collection(db, 'projects'), limit(5)));
  
  snapshot.docs.forEach((d, i) => {
    console.log(`\n=== Sample ${i + 1} ===`);
    console.log('Fields:', Object.keys(d.data()));
    console.log('Data:', JSON.stringify(d.data(), null, 2));
  });
})();
