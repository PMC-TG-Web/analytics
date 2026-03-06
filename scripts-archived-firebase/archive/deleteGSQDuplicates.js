const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');
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

async function deleteGSQDuplicates() {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);

    let primaryDocId = null;
    const duplicateDocIds = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectNumber === '2601 - GSQ') {
        // The document with items array is the primary
        if (data.items && Array.isArray(data.items) && data.items.length > 1) {
          primaryDocId = doc.id;
        } else {
          duplicateDocIds.push(doc.id);
        }
      }
    });

    console.log(`Found primary document: ${primaryDocId}`);
    console.log(`Found ${duplicateDocIds.length} duplicate documents to delete`);

    // Delete duplicates
    for (const docId of duplicateDocIds) {
      await deleteDoc(doc(db, 'projects', docId));
      console.log(`✓ Deleted ${docId}`);
    }

    console.log(`\n✓ Successfully deleted ${duplicateDocIds.length} duplicate GSQ documents`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

deleteGSQDuplicates();
