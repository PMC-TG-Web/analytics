const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, limit, query } = require('firebase/firestore');
const path = require('path');
const config = require(path.resolve(__dirname, '../src/firebaseConfig.json'));
initializeApp(config);
const db = getFirestore();

(async () => {
  const q = query(collection(db, 'projects'), limit(30));
  const snap = await getDocs(q);
  const seen = new Set();
  console.log('Sample Firestore customer|projectName pairs:');
  console.log('---');
  snap.docs.forEach(d => {
    const data = d.data();
    const key = `${data.customer}|${data.projectName}`;
    if (!seen.has(key)) {
      console.log(key);
      seen.add(key);
    }
  });
})();
