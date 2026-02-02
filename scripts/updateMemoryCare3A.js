const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');
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

async function findAndUpdateMemoryCare3A() {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);

    let found = false;

    for (const docSnapshot of snapshot.docs) {
      const projectData = docSnapshot.data();
      
      if (projectData.projectName === 'Memory Care 3A' || projectData.projectNumber === '2510 - MC3A') {
        console.log(`Found Memory Care 3A:`);
        console.log(`  Current sales: $${projectData.sales}`);
        console.log(`  Current cost: $${projectData.cost}`);
        console.log(`  Items: ${projectData.items?.length || 0}`);

        // Update to 250,105
        const docRef = doc(db, 'projects', docSnapshot.id);
        await updateDoc(docRef, {
          sales: 250105
        });

        console.log(`\n✓ Updated Memory Care 3A sales to $250,105`);
        found = true;
        break;
      }
    }

    if (!found) {
      console.log('Memory Care 3A not found');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

findAndUpdateMemoryCare3A();
