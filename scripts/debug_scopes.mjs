
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore';
import { readFileSync } from 'fs';

const firebaseConfig = JSON.parse(readFileSync('src/firebaseConfig.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectCollections() {
  const collectionsToCheck = ['projectScopes', 'scopes', 'costItems', 'projects'];
  
  for (const colName of collectionsToCheck) {
    console.log(`\nChecking collection: ${colName}`);
    try {
      const q = query(collection(db, colName), limit(5));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        console.log(`  Collection '${colName}' is EMPTY.`);
      } else {
        console.log(`  Collection '${colName}' found with ${snapshot.size} documents (limited to 5).`);
        snapshot.forEach(doc => {
          console.log(`  - ID: ${doc.id}`);
          const data = doc.data();
          if (colName === 'projects') {
             // For projects, check for scope-related fields
             console.log(`    Fields: ${Object.keys(data).join(', ')}`);
             console.log(`    projectName: ${data.projectName}`);
             if (data.scopes) console.log(`    scopes: ${JSON.stringify(data.scopes).substring(0, 100)}...`);
             if (data.costItems) console.log(`    costItems: ${JSON.stringify(data.costItems).substring(0, 100)}...`);
             if (data.costitems) console.log(`    costitems: ${JSON.stringify(data.costitems).substring(0, 100)}...`);
          } else {
             console.log(`    Data: ${JSON.stringify(data).substring(0, 200)}...`);
          }
        });
      }
    } catch (error) {
      console.log(`  Error checking collection '${colName}': ${error.message}`);
    }
  }
  
  process.exit(0);
}

inspectCollections();
