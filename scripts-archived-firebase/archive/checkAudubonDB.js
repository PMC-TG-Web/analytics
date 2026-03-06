const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs } = require('firebase/firestore');
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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkDBProject() {
  const q = query(collection(db, 'projects'), where('projectName', '==', 'Audubon Collegeville'));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    console.log('Project not found in DB.');
  } else {
    snapshot.forEach(doc => {
      console.log('--- DB Record: Audubon Collegeville ---');
      console.log('Status:', doc.data().status);
      console.log('Date Created:', doc.data().dateCreated);
      console.log('Bid Submitted Date:', doc.data().bidSubmittedDate);
      console.log('Sales:', doc.data().sales);
    });
  }
  process.exit(0);
}

checkDBProject();
