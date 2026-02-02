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
  
  const postConstComplete = projects.filter(p => 
    p.projectStage === 'Post-Construction' && p.status === 'Complete'
  );
  
  console.log(`Projects with projectStage="Post-Construction" AND status="Complete": ${postConstComplete.length}`);
  
  const totalSales = postConstComplete.reduce((sum, p) => sum + (p.sales || 0), 0);
  console.log(`Total Sales: $${totalSales.toLocaleString()}`);
  
  // Show unique projects
  const uniqueProjects = new Map();
  postConstComplete.forEach(p => {
    const key = `${p.projectNumber}|${p.customer}`;
    if (!uniqueProjects.has(key)) {
      uniqueProjects.set(key, { count: 0, sales: 0, name: p.projectName, customer: p.customer, projectNumber: p.projectNumber });
    }
    const entry = uniqueProjects.get(key);
    entry.count++;
    entry.sales += (p.sales || 0);
  });
  
  console.log(`\nUnique projects: ${uniqueProjects.size}\n`);
  
  const sorted = Array.from(uniqueProjects.values()).sort((a, b) => b.sales - a.sales);
  sorted.slice(0, 10).forEach((p, i) => {
    console.log(`${i + 1}. ${p.customer} - ${p.name} (${p.projectNumber})`);
    console.log(`   Sales: $${p.sales.toLocaleString()} | Line Items: ${p.count}`);
  });
})();
