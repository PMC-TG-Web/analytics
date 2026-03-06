
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, limit, query } from 'firebase/firestore/lite';
import { readFileSync } from 'fs';

const firebaseConfig = JSON.parse(readFileSync('src/firebaseConfig.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectCollections() {
  const collectionsToCheck = ['projectScopes', 'scopes', 'costItems', 'projects', 'short term schedual', 'long term schedual'];
  
  for (const colName of collectionsToCheck) {
    console.log(`\nChecking collection: ${colName}`);
    try {
      const colRef = collection(db, colName);
      const snapshot = await getDocs(colRef); // Firestore Lite doesn't support complex queries as easily, but plain collection worked in the bootstrapLite script.
      
      if (snapshot.empty) {
        console.log(`  Collection '${colName}' is EMPTY.`);
      } else {
        console.log(`  Collection '${colName}' found with ${snapshot.docs.length} documents.`);
        snapshot.docs.slice(0, 3).forEach(doc => {
          console.log(`  - ID: ${doc.id}`);
          const data = doc.data();
          if (colName === 'projects') {
             console.log(`    Fields: ${Object.keys(data).join(', ')}`);
             if (data.items) console.log(`    items array found with ${data.items.length} items.`);
             if (data.costitems) console.log(`    costitems field: ${data.costitems}`);
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
