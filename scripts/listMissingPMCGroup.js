const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function listMissingPMCGroup() {
  try {
    const snapshot = await getDocs(collection(db, 'projects'));
    const missing = [];

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (!data.pmcGroup) {
        missing.push({ id: docSnap.id, ...data });
      }
    });

    console.log(`Total missing pmcGroup: ${missing.length}`);

    console.log('\nSample missing pmcGroup (first 30):');
    missing.slice(0, 30).forEach((r, idx) => {
      console.log(
        `${idx + 1}. ${r.projectName || 'null'} | ${r.customer || 'null'} | ${r.costitems || 'null'} | ${r.projectNumber || 'null'} | ${r.status || 'null'}`
      );
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

listMissingPMCGroup();
