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
    
    const allGroups = {};
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectArchived) return;
      
      const groupName = (data.pmcGroup ?? '').toString().trim();
      if (!groupName) return;
      
      const hours = Number(data.hours ?? 0);
      if (Number.isFinite(hours)) {
        allGroups[groupName] = (allGroups[groupName] || 0) + hours;
      }
    });
    
    console.log('\n=== All PMC Groups (Top 30) ===\n');
    const sorted = Object.entries(allGroups).sort((a, b) => b[1] - a[1]).slice(0, 30);
    
    sorted.forEach(([group, hours]) => {
      console.log(`${group}: ${hours.toLocaleString()} hours`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
