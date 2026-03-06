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

async function checkGSQ() {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);

    for (const docSnapshot of snapshot.docs) {
      const projectData = docSnapshot.data();
      
      if (projectData.projectNumber === '2601 - GSQ') {
        console.log('GSQ Project Document:');
        console.log(`  Top-level sales: ${projectData.sales}`);
        console.log(`  Top-level cost: ${projectData.cost}`);
        console.log(`  Items array length: ${projectData.items?.length || 0}`);
        
        if (projectData.items) {
          const itemsSales = projectData.items.reduce((sum, item) => sum + (item.sales || 0), 0);
          const itemsCost = projectData.items.reduce((sum, item) => sum + (item.cost || 0), 0);
          console.log(`  Sum of item sales: ${itemsSales}`);
          console.log(`  Sum of item cost: ${itemsCost}`);
        }
        break;
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

checkGSQ();
