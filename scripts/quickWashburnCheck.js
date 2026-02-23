const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
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

initializeApp(firebaseConfig);
const db = getFirestore();

async function quickCheck() {
  try {
    const projectsSnapshot = await getDocs(query(
      collection(db, "projects"),
      where("projectName", "==", "Washburn Dam"),
      where("projectArchived", "==", false)
    ));
    
    const projects = projectsSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));

    console.log(`\nFound ${projects.length} Washburn Dam documents\n`);

    const scopeTotals = {};
    
    projects.forEach(p => {
      const scopeName = (p.scopeOfWork || 'No Scope').trim();
      const hours = p.hours || 0;
      const costitems = p.costitems || '';
      
      if (!scopeTotals[scopeName]) {
        scopeTotals[scopeName] = { total: 0, items: [] };
      }
      
      if (hours > 0) {
        scopeTotals[scopeName].total += hours;
        scopeTotals[scopeName].items.push({ costitems, hours });
      }
    });

    console.log('=== HOURS BY SCOPE ===\n');
    Object.entries(scopeTotals).forEach(([scope, data]) => {
      if (data.total > 0) {
        console.log(`${scope}: ${data.total} hrs`);
        data.items.forEach(item => {
          console.log(`  - ${item.costitems}: ${item.hours} hrs`);
        });
        console.log('');
      }
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

quickCheck();
