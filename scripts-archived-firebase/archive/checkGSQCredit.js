const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
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

async function checkGSQCredit() {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);

    let gsqDoc = null;
    for (const doc of snapshot.docs) {
      if (doc.data().projectNumber === '2601 - GSQ') {
        gsqDoc = doc;
        break;
      }
    }

    if (!gsqDoc) {
      console.log('No Goods Store Quarryville project found');
      process.exit(1);
    }

    const gsqData = gsqDoc.data();
    const items = gsqData.items || [];
    
    console.log(`\nTotal items in GSQ project: ${items.length}`);
    console.log('\nLast 5 items:');
    items.slice(-5).forEach((item, idx) => {
      const itemNum = items.length - 5 + idx + 1;
      console.log(`${itemNum}. [${item.Costitems}] Sales: ${item.sales} | Cost: ${item.cost}`);
    });
    
    // Find Over/Under item
    const overUnder = items.find(item => item.Costitems === 'Over/Under');
    if (overUnder) {
      console.log('\n✓ Over/Under item found:');
      console.log(`  Sales: ${overUnder.sales}`);
      console.log(`  Cost: ${overUnder.cost}`);
    } else {
      console.log('\n✗ Over/Under item NOT found');
    }
    
    // Calculate totals
    const totalSales = items.reduce((sum, item) => sum + (item.sales || 0), 0);
    const totalCost = items.reduce((sum, item) => sum + (item.cost || 0), 0);
    
    console.log(`\nTotal sales (all items): $${totalSales.toFixed(2)}`);
    console.log(`Total cost (all items): $${totalCost.toFixed(2)}`);
    
  } catch (error) {
    console.error('Error checking GSQ credit:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

checkGSQCredit();
