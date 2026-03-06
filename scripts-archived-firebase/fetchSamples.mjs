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

async function fetchSamples() {
  console.log('--- Projects Collection Samples ---');
  const projectSnap = await getDocs(query(collection(db, 'projects'), limit(10)));
  // Shuffle or just take first 3 from the 10
  const projects = projectSnap.docs.map(doc => doc.data());
  projects.slice(0, 3).forEach(p => {
    console.log(`Customer: "${p.customer}", Project Number: "${p.projectNumber}", Project Name: "${p.projectName}"`);
  });

  console.log('\n--- ProjectScopes Collection Samples ---');
  const scopeSnap = await getDocs(query(collection(db, 'projectScopes'), limit(20)));
  const scopes = scopeSnap.docs.map(doc => doc.data());
  let count = 0;
  scopes.forEach(s => {
    if (s.jobKey && count < 3) {
      console.log(`Job Key: "${s.jobKey}"`);
      count++;
    }
  });
  if (count === 0) console.log('No projectScopes with jobKey found in sample.');

  process.exit(0);
}

fetchSamples().catch(err => {
  console.error(err);
  process.exit(1);
});
