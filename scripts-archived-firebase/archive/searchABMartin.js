const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

(async () => {
  const snapshot = await getDocs(collection(db, 'projects'));
  const projects = snapshot.docs.map(d => d.data());
  
  const matches = projects.filter(p => {
    const name = (p.projectName || '').toString().toLowerCase();
    const customer = (p.customer || '').toString().toLowerCase();
    return name.includes('denver') || customer.includes('ab martin');
  });
  
  console.log(`Found ${matches.length} matching projects\n`);
  
  // Group by unique project
  const unique = new Map();
  matches.forEach(p => {
    const key = `${p.projectNumber}|${p.customer}|${p.projectName}`;
    if (!unique.has(key)) {
      unique.set(key, { ...p, lineItems: 1, totalSales: p.sales || 0 });
    } else {
      const existing = unique.get(key);
      existing.lineItems++;
      existing.totalSales += (p.sales || 0);
    }
  });
  
  console.log(`Unique projects: ${unique.size}\n`);
  
  unique.forEach(p => {
    console.log('Customer:', p.customer);
    console.log('Project:', p.projectName);
    console.log('Number:', p.projectNumber);
    console.log('Status:', p.status);
    console.log('ProjectStage:', p.projectStage);
    console.log('Total Sales:', '$' + p.totalSales.toLocaleString());
    console.log('Line Items:', p.lineItems);
    console.log('---');
  });
})();
