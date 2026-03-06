const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');
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

async function recalculateProjectTotals() {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);

    let updated = 0;

    for (const docSnapshot of snapshot.docs) {
      const projectData = docSnapshot.data();
      
      if (!projectData.items || !Array.isArray(projectData.items)) {
        continue;
      }

      // Calculate totals from items
      const items = projectData.items;
      const totalSales = items.reduce((sum, item) => sum + (item.sales || 0), 0);
      const totalCost = items.reduce((sum, item) => sum + (item.cost || 0), 0);
      const totalHours = items.reduce((sum, item) => sum + (item.hours || 0), 0);
      const totalLaborSales = items.reduce((sum, item) => sum + (item.LaborSales || 0), 0);
      const totalLaborCost = items.reduce((sum, item) => sum + (item.LaborCost || 0), 0);

      // Check if update is needed
      if (
        projectData.sales !== totalSales ||
        projectData.cost !== totalCost ||
        projectData.hours !== totalHours ||
        projectData.laborSales !== totalLaborSales ||
        projectData.laborCost !== totalLaborCost
      ) {
        const docRef = doc(db, 'projects', docSnapshot.id);
        await updateDoc(docRef, {
          sales: totalSales,
          cost: totalCost,
          hours: totalHours,
          laborSales: totalLaborSales,
          laborCost: totalLaborCost,
        });
        updated++;
        console.log(`✓ Updated ${projectData.projectNumber}: sales=$${totalSales.toFixed(2)}`);
      }
    }

    console.log(`\n✓ Total projects updated: ${updated}`);
    
  } catch (error) {
    console.error('Error recalculating project totals:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

recalculateProjectTotals();
