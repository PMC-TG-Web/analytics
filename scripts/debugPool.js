
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findGiantProjects() {
  const snapshot = await getDocs(collection(db, 'projects'));
  const projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const qualifyingStatuses = ["In Progress", "Accepted"];

  const pool = projects.filter(p => !p.projectArchived && qualifyingStatuses.includes(p.status));
  
  const byJob = {};
  pool.forEach(p => {
    const key = p.jobKey || `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    if (!byJob[key]) byJob[key] = { hours: 0, projected: 0, items: 0, name: p.projectName };
    byJob[key].hours += (Number(p.hours) || 0);
    byJob[key].projected += (Number(p.projectedPreconstHours) || 0);
    byJob[key].items++;
  });

  const sorted = Object.entries(byJob)
    .map(([key, data]) => ({ key, ...data, total: data.hours + data.projected }))
    .sort((a, b) => b.total - a.total);

  console.log("Top 20 Pool Contributors:");
  sorted.slice(0, 20).forEach(s => {
    console.log(`${s.total.toFixed(0)}h | ${s.name} (${s.items} items, hours: ${s.hours.toFixed(0)}, proj: ${s.projected.toFixed(0)})`);
  });

  const grandTotal = sorted.reduce((sum, s) => sum + s.total, 0);
  console.log("\nGrand Total (Additive):", grandTotal.toFixed(0));
}

findGiantProjects();
