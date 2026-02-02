const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

// Firebase config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Fallback to firebaseConfig.json if env vars missing
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

async function listUnmatchedPMCGroup() {
  try {
    console.log('Loading projects...');
    const snapshot = await getDocs(collection(db, 'projects'));

    const unmatched = new Set();
    const unmatchedDocs = [];
    let totalUnmatched = 0;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const hasPMCGroup = data.pmcGroup !== undefined && data.pmcGroup !== null && String(data.pmcGroup).trim() !== '';
      if (!hasPMCGroup) {
        totalUnmatched += 1;
        const costItem = (data.costitems || '').toString().trim();
        if (costItem) {
          unmatched.add(costItem);
        }
        unmatchedDocs.push({ id: docSnap.id, costitems: costItem || null });
      }
    });

    const unmatchedList = Array.from(unmatched).sort((a, b) => a.localeCompare(b));

    console.log(`Total projects without PMCGroup: ${totalUnmatched}`);
    console.log(`Unique costitems without match: ${unmatchedList.length}`);
    console.log('--- Unmatched costitems ---');
    unmatchedList.forEach((item) => console.log(item));

    console.log('--- Unmatched project document IDs ---');
    unmatchedDocs.forEach((item) => {
      console.log(`${item.id} | costitems: ${item.costitems ?? 'null'}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

listUnmatchedPMCGroup();
