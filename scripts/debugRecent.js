const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, limit, query, where } = require('firebase/firestore');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('src/firebaseConfig.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app);

async function debug() {
  console.log('--- Checking 5 recent projects ---');
  // Since I just ran the sync, newest ones should have today's date
  const q = query(collection(db, 'projects'), limit(10));
  const snap = await getDocs(q);
  snap.docs.forEach(d => {
    const data = d.data();
    console.log(`ID: ${d.id} | Name: ${data.projectName} | Status: ${data.status} | Created: ${data.createdAt}`);
  });
}

debug();
