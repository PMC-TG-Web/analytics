const { initializeApp, getApps } = require("firebase/app");
const { getFirestore, collection, getDocs, query, where } = require("firebase/firestore");
const fs = require('fs');

const firebaseConfig = {
  apiKey: "AIzaSyB...", // I'll use the one from the project if I can find it or just run it via node if setup
  projectId: "pmc-tg-reporting"
};

// Instead of hardcoding, I'll read from src/firebaseConfig.ts if possible
async function checkSales() {
  const { db } = require('./src/firebase'); // Assuming this works in node if setup
  
  const q = query(collection(db, "projects"), where("status", "==", "Bid Submitted"));
  const snapshot = await getDocs(q);
  
  let totalSales = 0;
  let count = 0;
  const projectSales = new Map();

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.projectArchived) return;
    
    const sales = Number(data.sales || 0);
    const identifier = (data.projectNumber || data.projectName || "").toString().trim();
    
    totalSales += sales;
    count++;
    
    if (!projectSales.has(identifier)) {
        projectSales.set(identifier, 0);
    }
    projectSales.set(identifier, projectSales.get(identifier) + sales);
  });

  console.log(`Total Bid Submitted Projects Found: ${count}`);
  console.log(`Total Bid Submitted Sales (Raw Sum): $${totalSales.toLocaleString()}`);
  
  // Apply deduplication like KPI page
  // Pick one customer per project identifier
  // ... existing code ...
}
