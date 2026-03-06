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
    const snapshot = await getDocs(collection(db, 'projects'));
    let total = 0;

    snapshot.forEach((doc) => {
      const p = doc.data();
      if (p.projectArchived) return;
      const customer = (p.customer ?? '').toString().toLowerCase();
      if (customer.includes('sop inc')) return;
      const projectName = (p.projectName ?? '').toString().toLowerCase();
      if (projectName === 'pmc operations') return;
      if (projectName === 'pmc shop time') return;
      if (projectName === 'pmc test project') return;
      if (projectName.includes('sandbox')) return;
      if (projectName.includes('raymond king')) return;
      if (projectName === 'alexander drive addition latest') return;
      const estimator = (p.estimator ?? '').toString().trim();
      if (!estimator) return;
      if (estimator.toLowerCase() === 'todd gilmore') return;
      const projectNumber = (p.projectNumber ?? '').toString().toLowerCase();
      if (projectNumber === '701 poplar church rd') return;

      const groupName = (p.pmcGroup ?? '').toString().trim().toLowerCase();
      if (!groupName || !(groupName.startsWith('pm ') || groupName === 'pm' || groupName.startsWith('pm-'))) return;

      const hours = Number(p.hours ?? 0);
      if (!Number.isFinite(hours)) return;
      total += hours;
    });

    console.log(`PM hours with dashboard exclusions: ${total.toFixed(2)}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
