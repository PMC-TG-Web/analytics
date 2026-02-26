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

function getProjectKey(p) {
  const customer = (p.customer || "").trim().replace(/\s+/g, " ");
  const projectNumber = (p.projectNumber || "").trim().replace(/\s+/g, " ");
  const projectName = (p.projectName || "").trim().replace(/\s+/g, " ");
  return `${customer}|${projectNumber}|${projectName}`.toLowerCase();
}

async function checkScopesForProject() {
  try {
    // Get one example project - Giant #6582
    const projectsSnapshot = await getDocs(query(
      collection(db, "projects"),
      where("projectName", "==", "Giant #6582"),
      where("projectArchived", "==", false)
    ));
    
    const projects = projectsSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));

    console.log(`\n=== Giant #6582 Project Analysis ===`);
    console.log(`Found ${projects.length} project documents with this name\n`);

    // Get the jobKey for this project
    const jobKey = projects.length > 0 ? getProjectKey(projects[0]) : null;
    
    if (jobKey) {
      console.log(`JobKey: ${jobKey}\n`);

      // Check projectScopes collection
      const scopesSnapshot = await getDocs(query(
        collection(db, "projectScopes"),
        where("jobKey", "==", jobKey)
      ));
      
      console.log(`=== ProjectScopes Collection ===`);
      console.log(`Found ${scopesSnapshot.docs.length} scope documents for this jobKey\n`);
      
      if (scopesSnapshot.docs.length > 0) {
        scopesSnapshot.docs.slice(0, 5).forEach(doc => {
          const data = doc.data();
          console.log(`  - ${data.scopeName || data.name || 'Unnamed'}`);
        });
        if (scopesSnapshot.docs.length > 5) {
          console.log(`  ... and ${scopesSnapshot.docs.length - 5} more`);
        }
      }

      console.log(`\n=== Projects Collection (scopeOfWork field) ===`);
      projects.slice(0, 5).forEach(p => {
        console.log(`  - ${p.scopeOfWork || 'No scopeOfWork field'}`);
      });
      if (projects.length > 5) {
        console.log(`  ... and ${projects.length - 5} more`);
      }
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

checkScopesForProject();
