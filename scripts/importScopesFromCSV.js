const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, addDoc, query, where, deleteDoc } = require('firebase/firestore');

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

  // Parse header line properly (handling quoted commas)
  const headerParts = [];
  let current = '';
  let inQuotes = false;
  const headerLine = lines[0];
  
  for (let i = 0; i < headerLine.length; i++) {
    const char = headerLine[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      headerParts.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  headerParts.push(current.trim().replace(/^"|"$/g, ''));

  const projectNameIdx = headerParts.findIndex(h => h.toLowerCase() === 'projectname');
  const projectNumberIdx = headerParts.findIndex(h => h.toLowerCase() === 'projectnumber');
  const customerIdx = headerParts.findIndex(h => h.toLowerCase() === 'customer');
  const scopeIdx = headerParts.findIndex(h => h.toLowerCase() === 'scopeofwork');
  const hoursIdx = headerParts.findIndex(h => h.toLowerCase() === 'hours');
  const salesIdx = headerParts.findIndex(h => h.toLowerCase() === 'sales');
  const costIdx = headerParts.findIndex(h => h.toLowerCase() === 'cost');
  const costTypeIdx = headerParts.findIndex(h => h.toLowerCase() === 'costtype');
  const costItemsIdx = headerParts.findIndex(h => h.toLowerCase() === 'costitems');

  console.log(`CSV Headers: ${headerParts.length} columns`);
  if (projectNameIdx === -1 || customerIdx === -1 || scopeIdx === -1) {
    console.error('Column indices:', { projectNameIdx, customerIdx, scopeIdx, hoursIdx, salesIdx, costIdx, costTypeIdx });
    console.error('First 10 headers:', headerParts.slice(0, 10).join(', '));
    process.exit(1);
  }

  console.log(`Using columns - projectName[${projectNameIdx}], customer[${customerIdx}], scope[${scopeIdx}], hours[${hoursIdx}], sales[${salesIdx}], cost[${costIdx}], costType[${costTypeIdx}]`);

  // Parse CSV data lines using proper CSV parser
  const parseCSVLine = (line) => {
    const parts = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        parts.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    parts.push(current.trim().replace(/^"|"$/g, ''));
    return parts;
  };

  // Group by customer + projectName + scopeOfWork (one document per unique scope)
  const grouped = {};
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCSVLine(lines[i]);
    const customer = parts[customerIdx]?.trim() || '';
    const projectName = parts[projectNameIdx]?.trim() || '';
    const projectNumber = parts[projectNumberIdx]?.trim() || '';
    const scopeOfWork = parts[scopeIdx]?.trim() || '';
    const hoursStr = parts[hoursIdx]?.trim() || '0';
    const salesStr = parts[salesIdx]?.trim() || '0';
    const costStr = parts[costIdx]?.trim() || '0';
    const costType = (parts[costTypeIdx]?.trim() || '').toLowerCase();
    const costItems = (parts[costItemsIdx]?.trim() || '').toLowerCase();
    const hours = parseFloat(hoursStr) || 0;
    const sales = parseFloat(salesStr) || 0;
    const cost = parseFloat(costStr) || 0;

    if (!customer || !projectName || !scopeOfWork) continue;

    // Use customer|projectName|scopeOfWork as unique key
    const key = `${customer}|${projectName}|${scopeOfWork}`;
    
    if (!grouped[key]) {
      grouped[key] = {
        customer,
        projectNumber,
        projectName,
        scopeOfWork,
        totalHours: 0,
        totalSales: 0,
        totalCost: 0,
      };
    }
    // Sum hours for this scope (exclude Management cost items)
    if (costItems !== 'management') {
      grouped[key].totalHours += hours;
    }
    grouped[key].totalSales += sales;
    grouped[key].totalCost += cost;
  }

  console.log(`CSV: Found ${Object.keys(grouped).length} unique customer|projectName|scope combinations`);

  // NO need to look up in Firestore - we'll just create jobKey ourselves
  // Format: customer~projectNumber~projectName
  
  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  // Load existing scopes
  const existingScopesSnapshot = await getDocs(collection(db, 'projectScopes'));
  const existingScopeKeys = new Set();
  existingScopesSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const key = `${data.jobKey}|${data.title}`;
    existingScopeKeys.add(key);
  });

  console.log(`\nFound ${existingScopeKeys.size} existing scopes`);

  for (const [key, group] of Object.entries(grouped)) {
    // Generate jobKey using the same format as existing Firestore documents
    const jobKey = `${group.customer}~${group.projectNumber}~${group.projectName}`;
    const scopeKey = `${jobKey}|${group.scopeOfWork}`;

    // Skip if already exists
    if (existingScopeKeys.has(scopeKey)) {
      duplicates++;
      continue;
    }

    try {
      // Create one scope document per unique scope
      const scopePayload = {
        jobKey,
        title: group.scopeOfWork,
        description: group.scopeOfWork,
        startDate: '',
        endDate: '',
        tasks: [],
        hours: group.totalHours,
        sales: group.totalSales,
        cost: group.totalCost,
      };

      await addDoc(collection(db, 'projectScopes'), scopePayload);
      imported++;
      if (imported <= 10) {
        console.log(`✓ ${group.projectName}: ${group.scopeOfWork.substring(0, 60)} (${group.totalHours.toFixed(1)} hrs)`);
      }
    } catch (error) {
      console.error(`✗ Failed for ${group.projectName}:`, error.message);
      skipped++;
    }
  }

  console.log(`\nImport complete: ${imported} imported, ${duplicates} skipped (existing), ${skipped} failed`);

  console.log(
    `\n✅ Import complete: ${imported} new scopes, ${duplicates} duplicates skipped, ${skipped} failed`
  );
  process.exit(0);
}

importScopes().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
