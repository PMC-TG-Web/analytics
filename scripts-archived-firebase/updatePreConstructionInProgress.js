const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch, doc } = require('firebase/firestore');
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

async function updatePreConstructionInProgress() {
  try {
    console.log('\n='.repeat(80));
    console.log('Fetching projects from Firestore...');
    console.log('='.repeat(80));
    
    const snapshot = await getDocs(collection(db, 'projects'));
    const allProjects = snapshot.docs.map(docSnap => ({
      id: docSnap.id,
      data: docSnap.data(),
    }));

    console.log(`Total projects fetched: ${allProjects.length}\n`);

    // Filter for projectStage = "Pre-Construction" and status = "In Progress"
    const matchingProjects = allProjects.filter(project => {
      const projectStage = (project.data.projectStage || '').trim();
      const status = (project.data.status || '').trim();
      
      return projectStage === 'Pre-Construction' && status === 'In Progress';
    });

    console.log(`Found ${matchingProjects.length} projects matching criteria:`);
    console.log('  - projectStage = "Pre-Construction"');
    console.log('  - status = "In Progress"');
    console.log('='.repeat(80));

    if (matchingProjects.length === 0) {
      console.log('\n✓ No projects to update. All done!');
      return;
    }

    // Show preview of what will be updated
    console.log('\nProjects to update:');
    matchingProjects.forEach((project, index) => {
      const { customer, projectName, projectNumber } = project.data;
      console.log(`${index + 1}. ${customer || 'N/A'} - ${projectName || 'N/A'} (${projectNumber || 'N/A'})`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('Starting batch updates...');
    console.log('='.repeat(80));

    // Update in batches (Firestore limit is 500 per batch)
    const BATCH_SIZE = 450;
    let updatedCount = 0;
    let batch = writeBatch(db);
    let batchOps = 0;

    for (const project of matchingProjects) {
      const docRef = doc(db, 'projects', project.id);
      batch.update(docRef, { status: 'Complete' });
      batchOps++;

      if (batchOps >= BATCH_SIZE) {
        await batch.commit();
        updatedCount += batchOps;
        console.log(`Committed batch: ${updatedCount} projects updated so far...`);
        batch = writeBatch(db);
        batchOps = 0;
      }
    }

    // Commit remaining operations
    if (batchOps > 0) {
      await batch.commit();
      updatedCount += batchOps;
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✓ SUCCESS: Updated ${updatedCount} projects`);
    console.log('  Changed status from "In Progress" to "Complete"');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error updating projects:', error);
    process.exit(1);
  }
}

updatePreConstructionInProgress();
