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
    
    const pmGroupHours = {};
    const pmGroupCounts = {};
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectArchived) return;
      
      const groupName = (data.pmcGroup ?? '').toString().trim();
      const normalized = groupName.toLowerCase();
      
      // Check if it matches PM criteria
      if (normalized && (normalized.startsWith('pm ') || normalized === 'pm' || normalized.startsWith('pm-'))) {
        const hours = Number(data.hours ?? 0);
        if (Number.isFinite(hours)) {
          pmGroupHours[groupName] = (pmGroupHours[groupName] || 0) + hours;
          pmGroupCounts[groupName] = (pmGroupCounts[groupName] || 0) + 1;
        }
      }
    });
    
    console.log('\n=== PM Groups Found ===\n');
    const sorted = Object.entries(pmGroupHours).sort((a, b) => b[1] - a[1]);
    
    let totalHours = 0;
    sorted.forEach(([group, hours]) => {
      console.log(`${group}: ${hours.toLocaleString()} hours (${pmGroupCounts[group]} records)`);
      totalHours += hours;
    });
    
    console.log(`\n=== TOTAL PM HOURS: ${totalHours.toLocaleString()} ===`);
    console.log(`=== TOTAL PM GROUPS: ${sorted.length} ===\n`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
