import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, limit } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const firebaseConfig = JSON.parse(
  readFileSync(join(__dirname, '../src/firebaseConfig.json'), 'utf8')
);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkFormats() {
  const collectionsToCheck = [
    'schedules',
    'projectScopes',
    'short term schedual',
    'long term schedual',
    'projects'
  ];

  for (const collName of collectionsToCheck) {
    console.log(`\n--- Collection: ${collName} ---`);
    try {
      const q = query(collection(db, collName), limit(50));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        console.log('No documents found.');
        continue;
      }

      let jobKeyCount = 0;
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.jobKey) {
            jobKeyCount++;
            if (jobKeyCount <= 3) {
                console.log(`ID: ${doc.id}`);
                console.log(`jobKey: ${data.jobKey}`);
            }
        }
      });

      console.log(`Found ${jobKeyCount} documents with jobKey out of ${snapshot.docs.length} sampled.`);
    } catch (error) {
      console.error(`Error checking ${collName}:`, error.message);
    }
  }
  process.exit(0);
}

checkFormats();
