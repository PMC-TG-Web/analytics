const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig).filter(([, value]) => !value).map(([key]) => key);
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

(async () => {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);
    const mc3aDocs = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectName === 'Memory Care 3A' || (data.projectNumber && data.projectNumber.includes('MC3A'))) {
        mc3aDocs.push({
          id: doc.id,
          projectNumber: data.projectNumber,
          projectName: data.projectName,
          sales: data.sales,
          items: data.items?.length || 0
        });
      }
    });
    
    console.log(`\nFound ${mc3aDocs.length} Memory Care 3A documents:\n`);
    let total = 0;
    mc3aDocs.forEach((doc, idx) => {
      console.log(`${idx + 1}. ID: ${doc.id.substring(0, 8)}..., Sales: $${(doc.sales || 0).toFixed(2)}, Items: ${doc.items}`);
      total += doc.sales || 0;
    });
    console.log(`\nTotal from all docs: $${total.toFixed(2)}`);
    console.log(`Expected: $249,004.52`);
    if (total > 249005) {
      console.log(`\n⚠ DUPLICATE DOCUMENTS DETECTED! Total is approximately ${(total / 249004.52).toFixed(1)}x the expected amount`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
