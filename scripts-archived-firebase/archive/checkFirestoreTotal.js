// scripts/checkFirestoreTotal.js
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkTotals() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    const querySnapshot = await getDocs(collection(db, 'projects'));
    
    let totalSales = 0;
    let totalCost = 0;
    let totalHours = 0;
    let count = 0;

    // Group by projectNumber to dedupe
    const projectMap = new Map();
    
    querySnapshot.docs.forEach(doc => {
      const data = doc.data();
      const projectNumber = data.projectNumber || `__noNumber__${doc.id}`;
      
      if (!projectMap.has(projectNumber)) {
        projectMap.set(projectNumber, []);
      }
      projectMap.get(projectNumber).push({ id: doc.id, ...data });
    });

    // For each project, take the most recent
    projectMap.forEach((docs, projectNumber) => {
      if (docs.length === 1) {
        const data = docs[0];
        totalSales += data.sales || 0;
        totalCost += data.cost || 0;
        totalHours += data.hours || 0;
        count++;
      } else {
        // Find most recent
        let mostRecent = docs[0];
        docs.forEach(d => {
          const dDate = new Date(d.dateUpdated || d.dateCreated || 0);
          const mostRecentDate = new Date(mostRecent.dateUpdated || mostRecent.dateCreated || 0);
          if (dDate > mostRecentDate) {
            mostRecent = d;
          }
        });
        totalSales += mostRecent.sales || 0;
        totalCost += mostRecent.cost || 0;
        totalHours += mostRecent.hours || 0;
        count++;
      }
    });

    console.log(`\n=== Firestore Totals (Deduplicated) ===`);
    console.log(`Total Projects: ${count}`);
    console.log(`Total Sales: $${totalSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`In millions: $${(totalSales/1000000).toFixed(2)}M`);
    console.log(`Total Cost: $${totalCost.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`Total Hours: ${totalHours.toLocaleString('en-US')}`);
    console.log(`\n=== Raw Totals (No Deduplication) ===`);
    
    let rawSales = 0;
    let rawCost = 0;
    let rawHours = 0;
    querySnapshot.docs.forEach(doc => {
      const data = doc.data();
      rawSales += data.sales || 0;
      rawCost += data.cost || 0;
      rawHours += data.hours || 0;
    });
    
    console.log(`Total Documents: ${querySnapshot.size}`);
    console.log(`Total Sales: $${rawSales.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`In millions: $${(rawSales/1000000).toFixed(2)}M`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkTotals();
