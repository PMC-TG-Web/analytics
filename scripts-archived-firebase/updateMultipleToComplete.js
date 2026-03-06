const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');
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

// Projects to mark as complete - using partial name matching
const projectsToComplete = [
  { search: ['ab martin', '34 denver'], name: 'AB Martin 34 Denver Road' },
  { search: ['learning', 'experience'], name: 'The Learning Experience' },
  { search: ['paneling sales', 'main building'], name: 'Paneling Sales - Main Building' },
  { search: ['goods store', 'ephrata', 'state street'], name: 'Goods Store - Ephrata State Street' },
  { search: ['ducklings', 'ambassador'], name: 'Ducklings Ambassador Circle' },
  { search: ['clark associates', 'lancaster'], name: 'Clark Associates Lancaster' },
  { search: ['guardian barriers'], name: 'Guardian Barriers' },
];

(async () => {
  try {
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);
    let updated = 0;
    let notFound = [];
    
    for (const projectToFind of projectsToComplete) {
      let found = false;
      
      for (const docSnapshot of snapshot.docs) {
        const projectData = docSnapshot.data();
        const projectName = (projectData.projectName || '').toLowerCase();
        
        // Check if all search terms are in the project name
        const allMatch = projectToFind.search.every(term => projectName.includes(term.toLowerCase()));
        
        if (allMatch) {
          const docRef = doc(db, 'projects', docSnapshot.id);
          await updateDoc(docRef, { status: 'Complete' });
          console.log(`✓ Updated: ${projectData.projectName}`);
          console.log(`  Project Number: ${projectData.projectNumber || 'N/A'}`);
          console.log(`  Previous Status: ${projectData.status || 'N/A'}`);
          updated++;
          found = true;
          break;
        }
      }
      
      if (!found) {
        notFound.push(projectToFind.name);
      }
    }
    
    console.log(`\n✓ Updated ${updated} projects to Complete status`);
    
    if (notFound.length > 0) {
      console.log(`\n⚠ Could not find: ${notFound.join(', ')}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
