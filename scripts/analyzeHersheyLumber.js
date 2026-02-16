import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(readFileSync(configPath, 'utf8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function analyzeHershey() {
  try {
    console.log("Searching in 'projects' collection...");
    
    const projectsRef = collection(db, 'projects');
    const snap = await getDocs(projectsRef);
    
    console.log(`Total documents in 'projects': ${snap.docs.length}`);

    const hersheyDocs = [];
    snap.docs.forEach(doc => {
      const data = doc.data();
      const projectName = data.projectName || '';
      const customer = data.customer || '';
      
      if (projectName.includes('Hershey Lumber Company') || customer.includes('Hershey Lumber Company')) {
        hersheyDocs.push(data);
      }
    });

    console.log(`Found ${hersheyDocs.length} documents for 'Hershey Lumber Company' in 'projects'.`);

    if (hersheyDocs.length > 0) {
      console.log("\nSample Hershey document with hours > 0:");
      const docWithHours = hersheyDocs.find(d => (parseFloat(d.hours) || 0) > 0);
      if (docWithHours) {
        console.log(JSON.stringify(docWithHours, null, 2));
      } else {
        console.log("No documents found with hours > 0.");
      }
    }

    const pmcGroups = {};
    
    hersheyDocs.forEach(data => {
      const group = data.pmcGroup || 'Unknown';
      const hours = parseFloat(data.hours) || 0;
      
      if (!pmcGroups[group]) {
        pmcGroups[group] = 0;
      }
      pmcGroups[group] += hours;
    });

    console.log("\nPMC Group Analysis for Hershey Lumber Company:");
    Object.keys(pmcGroups).sort().forEach(group => {
      console.log(`${group}: ${pmcGroups[group].toFixed(2)} hours`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

analyzeHershey();
