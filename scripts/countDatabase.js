const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function countDocs() {
  try {
    const snaps = await Promise.all([
      getDocs(collection(db, 'projects')),
      getDocs(collection(db, 'projectScopes')),
      getDocs(collection(db, 'short term schedual')),
      getDocs(collection(db, 'long term schedual'))
    ]);

    console.log(JSON.stringify({
      projects: snaps[0].size,
      scopes: snaps[1].size,
      shortTerm: snaps[2].size,
      longTerm: snaps[3].size
    }, null, 2));
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}

countDocs();
