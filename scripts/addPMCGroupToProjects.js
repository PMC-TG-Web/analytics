const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

// Firebase config
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Fallback to firebaseConfig.json if env vars missing
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

async function addPMCGroupToProjects() {
  try {
    console.log('Loading PMC grouping lookup table...');
    const groupingSnapshot = await getDocs(collection(db, 'pmcGrouping'));
    
    // Create lookup map: costItem (trimmed, lowercase) -> pmcGroup
    const lookupMap = new Map();
    groupingSnapshot.forEach((doc) => {
      const data = doc.data();
      const key = (data.costItem || '').trim().toLowerCase();
      if (key) {
        lookupMap.set(key, data.pmcGroup || null);
      }
    });
    
    console.log(`Loaded ${lookupMap.size} grouping mappings`);

    console.log('Loading projects in batches...');
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    const allProjects = projectsSnapshot.docs;
    console.log(`Found ${allProjects.length} projects to update`);

    let successCount = 0;
    let notFoundCount = 0;
    let errorCount = 0;
    const batchSize = 100;

    // Process in batches
    for (let i = 0; i < allProjects.length; i += batchSize) {
      const batch = allProjects.slice(i, i + batchSize);
      
      const updates = batch.map(async (projectDoc) => {
        try {
          const projectData = projectDoc.data();
          const costItem = (projectData.costitems || '').trim().toLowerCase();
          
          // Look up PMCGroup
          const pmcGroup = lookupMap.get(costItem) || null;
          
          if (pmcGroup) {
            // Update the project with PMCGroup
            await updateDoc(doc(db, 'projects', projectDoc.id), {
              pmcGroup: pmcGroup
            });
            successCount++;
          } else {
            notFoundCount++;
          }
        } catch (error) {
          errorCount++;
          if (errorCount <= 5) {
            console.error(`Error updating project ${projectDoc.id}:`, error.message);
          }
        }
      });

      await Promise.all(updates);
      
      const processed = Math.min(i + batchSize, allProjects.length);
      console.log(`Progress: ${processed}/${allProjects.length} processed (${successCount} matched, ${notFoundCount} not found, ${errorCount} errors)`);
    }

    console.log(`\n✅ Successfully updated ${successCount} projects with PMCGroup`);
    console.log(`⚠️  Projects without matching PMCGroup: ${notFoundCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

addPMCGroupToProjects();
