const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, deleteDoc } = require('firebase/firestore');
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
    const mc3aDocs = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.projectName === 'Memory Care 3A' || (data.projectNumber && data.projectNumber.includes('MC3A'))) {
        mc3aDocs.push({
          id: doc.id,
          sales: data.sales,
          items: data.items?.length || 0
        });
      }
    });
    
    console.log(`Found ${mc3aDocs.length} Memory Care 3A documents`);
    
    // Find the primary document (the one with the correct sales total of $249,004.52)
    const primaryDoc = mc3aDocs.find(d => Math.abs(d.sales - 249004.52) < 1);
    if (!primaryDoc) {
      console.error('Could not find primary Memory Care 3A document with $249,004.52');
      process.exit(1);
    }
    
    console.log(`Primary document: ${primaryDoc.id.substring(0, 8)}... (Sales: $${primaryDoc.sales.toFixed(2)})`);
    
    // Delete all other documents
    let deleted = 0;
    for (const mc3aDoc of mc3aDocs) {
      if (mc3aDoc.id !== primaryDoc.id) {
        await deleteDoc(doc(db, 'projects', mc3aDoc.id));
        console.log(`✓ Deleted ${mc3aDoc.id.substring(0, 8)}... (Sales: $${mc3aDoc.sales.toFixed(2)})`);
        deleted++;
      }
    }
    
    console.log(`\n✓ Successfully deleted ${deleted} duplicate Memory Care 3A documents`);
    console.log(`✓ Kept primary document with correct sales: $249,004.52`);
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
