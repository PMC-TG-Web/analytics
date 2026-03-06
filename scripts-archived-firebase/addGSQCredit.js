const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch, doc, updateDoc, arrayUnion } = require('firebase/firestore');
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

async function addGSQCredit() {
  try {
    const projectsRef = collection(db, 'projects');
    
    // Find the Goods Store Quarryville project
    const q = getDocs(projectsRef);
    const snapshot = await q;

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
    const gsqItems = gsqData.items || [];

    // Create the Over/Under credit line item
    const creditLineItem = {
      dateUpdated: '1/14/2026',
      ReasonForLoss: '',
      ProjectStage: 'Bidding',
      Costitems: 'Over/Under',
      CostType: 'Part',
      Quantity: 1,
      sales: -6610.63,
      LaborSales: 0,
      LaborCost: 0,
      cost: -6610.63,
      hours: 0,
      ProjectArchived: 'No',
      customer: 'Hoover Building Specialists, Inc.',
      projectName: 'Goods Store Quarryville',
      status: 'In Progress',
      TestProject: 'No',
      Active: 'Yes',
      dateCreated: '1/12/2026',
      estimator: 'Steffy Rick'
    };

    // Add the credit line to items array
    gsqItems.push(creditLineItem);

    // Update the document
    const docRef = doc(db, 'projects', gsqDoc.id);
    await updateDoc(docRef, {
      items: gsqItems
    });

    console.log('✓ Added Over/Under credit line to Goods Store Quarryville');
    console.log(`  Credit amount: -$6,610.63`);
    
    // Calculate new totals
    const totalSales = gsqItems.reduce((sum, item) => sum + (item.sales || 0), 0);
    const totalCost = gsqItems.reduce((sum, item) => sum + (item.cost || 0), 0);
    
    console.log(`  New project total sales: $${totalSales.toFixed(2)}`);
    console.log(`  New project total cost: $${totalCost.toFixed(2)}`);
    
  } catch (error) {
    console.error('Error adding GSQ credit:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

addGSQCredit();
