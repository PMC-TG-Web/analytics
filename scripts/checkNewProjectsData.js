const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkNewProjects() {
  try {
    console.log('\n========================================');
    console.log('Checking New Projects Data');
    console.log('========================================\n');

    const projectNames = [
      'CHN Site/GSC',
      'Hoover/Brecknock Orchards',
      'JE Horst/Jono Hardware',
      'JE Horst/Jubilee Ministries'
    ];

    for (const projectName of projectNames) {
      const q = query(collection(db, 'projects'), where('projectName', '==', projectName));
      const snapshot = await getDocs(q);
      
      if (snapshot.docs.length > 0) {
        const doc = snapshot.docs[0];
        const data = doc.data();
        
        console.log(`Project: ${projectName}`);
        console.log(`Document ID: ${doc.id}`);
        console.log('Fields:');
        
        Object.keys(data).sort().forEach(key => {
          const value = data[key];
          if (value === null) {
            console.log(`  ${key}: null`);
          } else if (value === undefined) {
            console.log(`  ${key}: undefined`);
          } else if (typeof value === 'object') {
            console.log(`  ${key}: ${JSON.stringify(value)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        });
        console.log('');
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkNewProjects();
