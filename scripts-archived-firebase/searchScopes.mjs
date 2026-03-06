import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(readFileSync(configPath, 'utf8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function search() {
  try {
    const projectsSnap = await getDocs(collection(db, 'projects'));
    console.log(`Searching through ${projectsSnap.docs.length} documents...`);

    let foundScopeCount = 0;
    let hersheyCount = 0;

    projectsSnap.docs.forEach(doc => {
      const data = doc.data();
      const hasScope = data.hasOwnProperty('scope');
      const hasScopeOfWork = data.hasOwnProperty('scopeOfWork');

      if (hasScope || hasScopeOfWork) {
        foundScopeCount++;
        console.log(`\nDocument ID: ${doc.id}`);
        if (hasScope) console.log(`scope: ${JSON.stringify(data.scope)}`);
        if (hasScopeOfWork) console.log(`scopeOfWork: ${JSON.stringify(data.scopeOfWork)}`);
      }

      const projectName = data.projectName || '';
      const customer = data.customer || '';
      
      if (projectName.includes('Hershey Lumber Company') || customer.includes('Hershey Lumber Company')) {
        hersheyCount++;
      }
    });

    console.log(`\nSummary:`);
    console.log(`Total documents with 'scope' or 'scopeOfWork': ${foundScopeCount}`);
    console.log(`Total documents for 'Hershey Lumber Company': ${hersheyCount}`);

    process.exit(0);
  } catch (error) {
    console.error('Error searching Firestore:', error);
    process.exit(1);
  }
}

search();
