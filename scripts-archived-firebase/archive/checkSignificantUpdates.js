const fs = require('fs');
const csv = require('csv-parse/sync');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
if (fs.existsSync(configPath)) {
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  Object.assign(firebaseConfig, fileConfig);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function summaryUpdates() {
  try {
    const filePath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (5).csv';
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const csvRecords = csv.parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

    // Group CSV by Project
    const csvProjects = new Map();
    csvRecords.forEach(r => {
      const name = (r['Estimating Project > Estimate Project Name'] || '').trim();
      const status = (r['Estimating Project > Status'] || '').trim();
      const sales = parseFloat((r['Estimate Layer > Total Sales'] || '0').replace(/[$,]/g, '')) || 0;
      
      if (!csvProjects.has(name)) csvProjects.set(name, { sales: 0, status });
      const p = csvProjects.get(name);
      p.sales += sales;
      // Note: Status might be different across line items, but usually it's per project
    });

    // Fetch DB
    const snapshot = await getDocs(collection(db, 'projects'));
    const dbProjects = new Map();
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const name = (data.projectName || '').trim();
      const status = (data.status || '').trim();
      const sales = parseFloat(data.sales) || 0;
      
      if (!dbProjects.has(name)) dbProjects.set(name, { sales: 0, status });
      const p = dbProjects.get(name);
      p.sales += sales;
    });

    console.log('\n--- Significant Project Updates ---');
    const updates = [];
    csvProjects.forEach((csvData, name) => {
      const dbData = dbProjects.get(name);
      if (!dbData) {
        updates.push({ name, type: 'NEW', newSales: csvData.sales, status: csvData.status });
      } else if (Math.abs(csvData.sales - dbData.sales) > 1 || csvData.status !== dbData.status) {
        updates.push({ 
          name, 
          type: 'UPDATE', 
          oldSales: dbData.sales, 
          newSales: csvData.sales, 
          oldStatus: dbData.status, 
          newStatus: csvData.status 
        });
      }
    });

    updates.sort((a, b) => Math.abs(b.newSales - (a.oldSales || 0)) - Math.abs(a.newSales - (b.oldSales || 0)));

    updates.slice(0, 15).forEach(u => {
      if (u.type === 'NEW') {
        console.log(`[NEW] ${u.name}: $${u.newSales.toLocaleString()} (${u.status})`);
      } else {
        const salesDiff = u.newSales - u.oldSales;
        const statusChange = u.oldStatus !== u.newStatus ? ` | Status: ${u.oldStatus} -> ${u.newStatus}` : '';
        console.log(`[UPD] ${u.name}: Sales Diff: $${salesDiff.toLocaleString()} ($${u.oldSales.toLocaleString()} -> $${u.newSales.toLocaleString()})${statusChange}`);
      }
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

summaryUpdates();
