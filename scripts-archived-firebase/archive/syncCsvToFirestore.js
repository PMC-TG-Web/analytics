const fs = require('fs');
const csv = require('csv-parse/sync');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch, doc } = require('firebase/firestore');
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

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

// Robust key generation
function getCleanKey(p, n, c, g, i) {
  const clean = (val) => (val || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  return `${clean(p)}|${clean(n)}|${clean(c)}|${clean(g)}|${clean(i)}`;
}

async function syncData() {
  try {
    console.log('--- Starting Robust Data Sync ---');
    
    // 1. Load CSV
    const filePath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (5).csv';
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const csvRecords = csv.parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

    // 2. Load DB
    console.log('Loading existing DB records...');
    const dbSnap = await getDocs(collection(db, 'projects'));
    const dbMap = new Map();
    dbSnap.docs.forEach(d => {
      const data = d.data();
      const key = getCleanKey(
        data.projectName,
        data.projectNumber,
        data.customer,
        data.pmcGroup || data.scopeOfWork,
        data.costItem || data.costitems
      );
      if (!dbMap.has(key)) dbMap.set(key, []);
      dbMap.get(key).push({ id: d.id, ...data });
    });
    console.log(`Loaded ${dbSnap.docs.length} records into map.`);

    // 3. Process CSV
    console.log('Processing updates and additions...');
    let batch = writeBatch(db);
    let updateCount = 0;
    let addCount = 0;
    let deleteDuplicateCount = 0;
    let batchSize = 0;

    for (const r of csvRecords) {
      const projectName = r['Estimating Project > Estimate Project Name'];
      const projectNumber = r['Project > Number'];
      const customer = r['Estimating Project > Customer Company'];
      const costItem = r['Estimate Layer > Cost Item'];
      const pmcGroup = r['Estimate Layer Group > Cost Item'];
      
      // Skip Alexander Drive Addition as requested
      if (projectName && projectName.includes('Alexander Drive Addition')) continue;

      const key = getCleanKey(projectName, projectNumber, customer, pmcGroup, costItem);
      const existingList = dbMap.get(key);

      const status = (r['Estimating Project > Status'] || '').trim();
      const sales = parseFloat((r['Estimate Layer > Total Sales'] || '0').replace(/[$,]/g, '')) || 0;
      const hours = parseFloat(r['Estimate Layer > Total Labor (Hours)'] || '0') || 0;
      const cost = parseFloat((r['Estimate Layer > Total Cost'] || '0').replace(/[$,]/g, '')) || 0;
      const dateCreated = (r['Project > Date Created'] || '').trim();
      const dateUpdated = (r['Estimating Project > Date Updated'] || '').trim();

      const newData = {
        projectName: (projectName || '').trim(),
        projectNumber: (projectNumber || '').trim(),
        customer: (customer || '').trim(),
        costItem: (costItem || '').trim(),
        status,
        sales,
        hours,
        cost,
        pmcGroup: (pmcGroup || '').trim(),
        dateCreated,
        dateUpdated,
        updatedAt: new Date().toISOString()
      };

      if (existingList && existingList.length > 0) {
        // Update the first one
        const primary = existingList[0];
        const oldSales = parseFloat(primary.sales) || 0;
        const oldStatus = (primary.status || '').trim();

        if (Math.abs(oldSales - sales) > 0.01 || oldStatus !== status || !primary.costItem) {
          batch.update(doc(db, 'projects', primary.id), newData);
          updateCount++;
          batchSize++;
        }

        // Delete duplicates
        for (let i = 1; i < existingList.length; i++) {
          batch.delete(doc(db, 'projects', existingList[i].id));
          deleteDuplicateCount++;
          batchSize++;
        }
        
        dbMap.set(key, []); 
      } else {
        // Add new or restored
        const newRef = doc(collection(db, 'projects'));
        batch.set(newRef, { ...newData, createdAt: new Date().toISOString() });
        addCount++;
        batchSize++;
        dbMap.set(key, [{ id: newRef.id }]);
      }

      if (batchSize >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        batchSize = 0;
      }
    }

    if (batchSize > 0) {
      await batch.commit();
    }

    console.log(`Sync Complete: ${updateCount} updated, ${addCount} added (restored), ${deleteDuplicateCount} duplicates removed.`);
    process.exit(0);
  } catch (err) {
    console.error('Error during sync:', err);
    process.exit(1);
  }
}

syncData();
