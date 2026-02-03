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

const isExcluded = (p) => {
  if (p.projectArchived) return true;
  const customer = (p.customer ?? '').toString().toLowerCase();
  if (customer.includes('sop inc')) return true;
  const projectName = (p.projectName ?? '').toString().toLowerCase();
  if (projectName === 'pmc operations') return true;
  if (projectName === 'pmc shop time') return true;
  if (projectName === 'pmc test project') return true;
  if (projectName.includes('sandbox')) return true;
  if (projectName.includes('raymond king')) return true;
  if (projectName === 'alexander drive addition latest') return true;
  const estimator = (p.estimator ?? '').toString().trim();
  if (!estimator) return true;
  if (estimator.toLowerCase() === 'todd gilmore') return true;
  const projectNumber = (p.projectNumber ?? '').toString().toLowerCase();
  if (projectNumber === '701 poplar church rd') return true;
  return false;
};

const isPmGroup = (groupName) => {
  const normalized = (groupName ?? '').toString().trim().toLowerCase();
  if (!normalized) return false;
  return normalized.startsWith('pm ') || normalized === 'pm' || normalized.startsWith('pm-');
};

(async () => {
  try {
    const snapshot = await getDocs(collection(db, 'projects'));
    let totalPm = 0;
    let bidSubmittedPm = 0;

    snapshot.forEach((doc) => {
      const p = doc.data();
      if (isExcluded(p)) return;
      if (!isPmGroup(p.pmcGroup)) return;
      const hours = Number(p.hours ?? 0);
      if (!Number.isFinite(hours)) return;
      totalPm += hours;
      if ((p.status ?? '') === 'Bid Submitted') {
        bidSubmittedPm += hours;
      }
    });

    console.log(`PM hours (all statuses): ${totalPm.toFixed(2)}`);
    console.log(`PM hours (Bid Submitted): ${bidSubmittedPm.toFixed(2)}`);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
