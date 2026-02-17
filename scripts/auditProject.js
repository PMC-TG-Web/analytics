const fs = require('fs');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const path = require('path');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
if (fs.existsSync(configPath)) {
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  Object.assign(firebaseConfig, fileConfig);
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

async function auditProject(name) {
  const q = query(collection(db, 'projects'), where('projectName', '==', name));
  const snapshot = await getDocs(q);
  
  console.log(`--- Audit for "${name}" ---`);
  const docs = snapshot.docs;
  // Show first 2 and last 2 if there are many
  const toShow = docs.length > 10 ? [...docs.slice(0, 5), ...docs.slice(-5)] : docs;

  toShow.forEach(doc => {
    const d = doc.data();
    const name = d.projectName || '';
    const num = d.projectNumber || '';
    const cust = d.customer || '';
    const item = d.costItem || d.costitems || '';
    const group = d.pmcGroup || '';
    console.log(`[${doc.id}] I: "${item}" | G: "${group}" | S: ${d.status}`);
  });
  console.log(`Total records for this project: ${docs.length}`);
  process.exit(0);
}

auditProject('Audubon Collegeville');
