const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, writeBatch } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function importScopes() {
  console.log('=== importScopes starting ===');
  
  const csvPath = path.resolve('C:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (4).csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV file not found at: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter((line) => line.trim());

  if (lines.length < 2) {
    console.error('CSV is empty or has no data rows');
    process.exit(1);
  }

  const parseCSVLine = (line) => {
    const parts = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        parts.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    parts.push(current.trim().replace(/^"|"$/g, ''));
    return parts;
  };

  const headerParts = parseCSVLine(lines[0]);

  const projectNameIdx = headerParts.findIndex(h => h.toLowerCase() === 'projectname');
  const projectNumberIdx = headerParts.findIndex(h => h.toLowerCase() === 'projectnumber');
  const customerIdx = headerParts.findIndex(h => h.toLowerCase() === 'customer');
  const scopeIdx = headerParts.findIndex(h => h.toLowerCase() === 'scopeofwork');
  const hoursIdx = headerParts.findIndex(h => h.toLowerCase() === 'hours');
  const salesIdx = headerParts.findIndex(h => h.toLowerCase() === 'sales');
  const costIdx = headerParts.findIndex(h => h.toLowerCase() === 'cost');
  const costItemsIdx = headerParts.findIndex(h => h.toLowerCase() === 'costitems');

  if (projectNameIdx === -1 || customerIdx === -1 || scopeIdx === -1) {
    console.error('Required columns missing.');
    process.exit(1);
  }

  const grouped = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    const customer = parts[customerIdx]?.trim() || '';
    const projectName = parts[projectNameIdx]?.trim() || '';
    const projectNumber = parts[projectNumberIdx]?.trim() || '';
    const scopeOfWork = parts[scopeIdx]?.trim() || '';
    const hours = parseFloat(parts[hoursIdx]?.trim() || '0') || 0;
    const sales = parseFloat(parts[salesIdx]?.trim() || '0') || 0;
    const cost = parseFloat(parts[costIdx]?.trim() || '0') || 0;
    const costItems = (parts[costItemsIdx]?.trim() || '').toLowerCase();

    if (!customer || !projectName || !scopeOfWork) continue;

    const key = `${customer}|${projectName}|${scopeOfWork}`;
    if (!grouped[key]) {
      grouped[key] = { customer, projectNumber, projectName, scopeOfWork, totalHours: 0, totalSales: 0, totalCost: 0 };
    }
    if (costItems !== 'management') grouped[key].totalHours += hours;
    grouped[key].totalSales += sales;
    grouped[key].totalCost += cost;
  }

  console.log(`CSV processed: ${Object.keys(grouped).length} unique scopes found.`);

  const existingScopesSnapshot = await getDocs(collection(db, 'projectScopes'));
  const existingScopeKeys = new Set();
  existingScopesSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    existingScopeKeys.add(`${data.jobKey}|${data.title}`);
  });

  console.log(`Checking against ${existingScopeKeys.size} existing scopes.`);

  let batch = writeBatch(db);
  let batchCount = 0;
  let imported = 0;
  let duplicates = 0;

  for (const group of Object.values(grouped)) {
    const jobKey = `${group.customer}~${group.projectNumber}~${group.projectName}`;
    const scopeKey = `${jobKey}|${group.scopeOfWork}`;

    if (existingScopeKeys.has(scopeKey)) {
      duplicates++;
      continue;
    }

    const scopeRef = doc(collection(db, 'projectScopes'));
    batch.set(scopeRef, {
      jobKey,
      title: group.scopeOfWork,
      description: group.scopeOfWork,
      startDate: '',
      endDate: '',
      tasks: [],
      hours: group.totalHours,
      sales: group.totalSales,
      cost: group.totalCost,
    });

    batchCount++;
    imported++;

    if (batchCount >= 500) {
      await batch.commit();
      console.log(`Committed batch of ${batchCount} scopes...`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${batchCount} scopes.`);
  }

  console.log(`\n✅ Import complete: ${imported} imported, ${duplicates} duplicates skipped.`);
  process.exit(0);
}

importScopes().catch(console.error);


importScopes().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
