const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

// Firebase config (prefer env vars, fallback to firebaseConfig.json)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingConfigKeys.length > 0) {
  const configPath = path.join(__dirname, '../src/firebaseConfig.json');
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  firebaseConfig.apiKey = fileConfig.apiKey;
  firebaseConfig.authDomain = fileConfig.authDomain;
  firebaseConfig.projectId = fileConfig.projectId;
  firebaseConfig.storageBucket = fileConfig.storageBucket;
  firebaseConfig.messagingSenderId = fileConfig.messagingSenderId;
  firebaseConfig.appId = fileConfig.appId;
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkGSQDocuments() {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);

    const gsqDocs = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectNumber === '2601 - GSQ' || data.projectName === 'Goods Store Quarryville') {
        gsqDocs.push({
          id: doc.id,
          projectNumber: data.projectNumber,
          projectName: data.projectName,
          customer: data.customer,
          sales: data.sales,
          items: data.items?.length || 0,
        });
      }
    });

    console.log(`Found ${gsqDocs.length} documents for GSQ:`);
    gsqDocs.forEach((doc, idx) => {
      console.log(`\n${idx + 1}. Document ID: ${doc.id}`);
      console.log(`   Project Number: ${doc.projectNumber}`);
      console.log(`   Project Name: ${doc.projectName}`);
      console.log(`   Customer: ${doc.customer}`);
      console.log(`   Sales: ${doc.sales}`);
      console.log(`   Items: ${doc.items}`);
    });

    const totalFromAllDocs = gsqDocs.reduce((sum, doc) => sum + (doc.sales || 0), 0);
    console.log(`\nTotal sales from all GSQ documents: $${totalFromAllDocs.toFixed(2)}`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

checkGSQDocuments();
