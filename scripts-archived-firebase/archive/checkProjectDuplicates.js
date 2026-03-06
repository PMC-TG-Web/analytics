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

async function checkProjectDuplicates() {
  try {
    // Get projects (excluding archived and certain statuses)
    const projectsSnapshot = await getDocs(query(
      collection(db, "projects"),
      where("status", "not-in", ["Bid Submitted", "Lost"]),
      where("projectArchived", "==", false)
    ));
    
    const projects = projectsSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));

    // Group by project name
    const projectsByName = {};
    projects.forEach(p => {
      const name = p.projectName || 'Unnamed';
      if (!projectsByName[name]) {
        projectsByName[name] = [];
      }
      projectsByName[name].push({
        id: p.id,
        customer: p.customer,
        projectNumber: p.projectNumber,
        status: p.status,
        scopeOfWork: p.scopeOfWork
      });
    });

    // Find projects with multiple entries
    const duplicates = Object.entries(projectsByName)
      .filter(([name, projects]) => projects.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    console.log(`\n=== Projects with Multiple Entries ===`);
    console.log(`Total unique project names: ${Object.keys(projectsByName).length}`);
    console.log(`Project names with duplicates: ${duplicates.length}\n`);

    // Show first 10 examples
    duplicates.slice(0, 10).forEach(([name, projects]) => {
      console.log(`"${name}" appears ${projects.length} times:`);
      projects.forEach(p => {
        console.log(`  - ID: ${p.id.substring(0, 8)}... | Customer: ${p.customer} | #${p.projectNumber} | Scope: ${p.scopeOfWork || 'None'}`);
      });
      console.log('');
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

checkProjectDuplicates();
