const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, limit, query } = require('firebase/firestore');
const fs = require('fs');

const firebaseConfig = JSON.parse(fs.readFileSync('./src/firebaseConfig.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkScopes() {
  console.log('Checking projectScopes collection...');
  const snapshot = await getDocs(query(collection(db, 'projectScopes'), limit(10)));
  if (snapshot.empty) {
    console.log('Collection "projectScopes" is EMPTY.');
  } else {
    snapshot.forEach(doc => {
      console.log(`Doc ID: ${doc.id}`);
      console.log(`jobKey: ${doc.data().jobKey}`);
      console.log(`title: ${doc.data().title}`);
      console.log('---');
    });
  }
  process.exit(0);
}

checkScopes().catch(err => {
  console.error(err);
  process.exit(1);
});
