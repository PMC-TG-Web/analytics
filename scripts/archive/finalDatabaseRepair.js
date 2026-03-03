const fs = require('fs');
const csv = require('csv-parse/sync');
const { initializeApp, getApps } = require('firebase/app');
const { getFirestore, collection, getDocs, writeBatch, doc } = require('firebase/firestore');
const path = require('path');

const config = JSON.parse(fs.readFileSync('src/firebaseConfig.json', 'utf8'));
const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
const db = getFirestore(app);

// Robust normalization for keys
function normalize(val) {
  return (val || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

async function repairDatabase() {
  try {
    console.log('--- Phase 1: Global Deduplication & Deletion ---');
    
    const snap = await getDocs(collection(db, 'projects'));
    console.log(`Analyzing ${snap.docs.length} records...`);

    const recordGroups = new Map();
    const toDelete = [];

    snap.docs.forEach(d => {
      const data = d.data();
      const pName = normalize(data.projectName);
      
      // 1. Mark Alexander for deletion
      if (pName.includes('alexander drive addition')) {
        toDelete.push(d.ref);
        return;
      }

      // 2. Generate key using the unified rule (Name | Num | Cust | Scope | Item)
      // Note: We check both field names for legacy compatibility
      const pNum = normalize(data.projectNumber);
      const pCust = normalize(data.customer);
      const pScope = normalize(data.pmcGroup || data.scopeOfWork || '');
      const pItem = normalize(data.costItem || data.costitems || '');

      const key = `${pName}|${pNum}|${pCust}|${pScope}|${pItem}`;
      
      if (!recordGroups.has(key)) {
        recordGroups.set(key, []);
      }
      recordGroups.get(key).push({ id: d.id, ref: d.ref, ...data });
    });

    // 3. Keep only the best record in each group
    for (const [key, records] of recordGroups.entries()) {
      if (records.length > 1) {
        // Sort: prefer records with actual field names 'costItem' and 'pmcGroup' 
        // and prefer those with a 'createdAt' timestamp
        records.sort((a, b) => {
          const aFull = (a.costItem ? 2 : 0) + (a.pmcGroup ? 1 : 0);
          const bFull = (b.costItem ? 2 : 0) + (b.pmcGroup ? 1 : 0);
          if (bFull !== aFull) return bFull - aFull;
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        // Delete all but the first (primary)
        for (let i = 1; i < records.length; i++) {
          toDelete.push(records[i].ref);
        }
      }
    }

    console.log(`Ready to delete ${toDelete.length} duplicates and Alexander records.`);

    let batch = writeBatch(db);
    let count = 0;
    for (const ref of toDelete) {
      batch.delete(ref);
      count++;
      if (count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    if (count % 400 !== 0) await batch.commit();
    
    console.log(`Phase 1 Complete. ${count} records purged.`);

    console.log('--- Phase 2: Syncing Latest Data from CSV ---');
    const csvPath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (5).csv';
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const csvRecords = csv.parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

    // Reload DB state after cleanup
    const cleanSnap = await getDocs(collection(db, 'projects'));
    const cleanMap = new Map();
    cleanSnap.docs.forEach(d => {
      const data = d.data();
      const key = `${normalize(data.projectName)}|${normalize(data.projectNumber)}|${normalize(data.customer)}|${normalize(data.pmcGroup || data.scopeOfWork)}|${normalize(data.costItem || data.costitems)}`;
      cleanMap.set(key, { id: d.id, ...data });
    });

    batch = writeBatch(db);
    let updates = 0;
    let adds = 0;
    let batchSize = 0;

    for (const r of csvRecords) {
      const pName = r['projectName'];
      const pNum = r['projectNumber'];
      const pCust = r['customer'];
      const pScope = r['ScopeOfWork'];
      const pItem = r['Costitems'];
      
      if (!pName) continue; // Skip malformed rows
      if (normalize(pName).includes('alexander drive addition')) continue;

      const key = `${normalize(pName)}|${normalize(pNum)}|${normalize(pCust)}|${normalize(pScope)}|${normalize(pItem)}`;
      const existing = cleanMap.get(key);

      const status = (r['status'] || '').trim();
      const sales = parseFloat((r['sales'] || '0').replace(/[$,]/g, '')) || 0;
      const hours = parseFloat(r['hours'] || '0') || 0;
      const cost = parseFloat((r['cost'] || '0').replace(/[$,]/g, '')) || 0;
      const dateCreated = (r['dateCreated'] || '').trim();
      const dateUpdated = (r['dateUpdated'] || '').trim();
      const estimator = (r['estimator'] || '').trim();

      const updatedData = {
        projectName: (pName || '').trim(),
        projectNumber: (pNum || '').trim(),
        customer: (pCust || '').trim(),
        costItem: (pItem || '').trim(),
        pmcGroup: (pScope || '').trim(),
        scopeOfWork: (pScope || '').trim(), // Duplicate for compatibility
        status,
        sales,
        hours,
        cost,
        dateCreated,
        dateUpdated,
        estimator,
        updatedAt: new Date().toISOString()
      };

      if (existing) {
        const hasChanged = 
          Math.abs((existing.sales || 0) - sales) > 0.01 || 
          (existing.status || '') !== status ||
          !existing.dateCreated ||
          !existing.estimator;
        
        if (hasChanged) {
          batch.update(doc(db, 'projects', existing.id), updatedData);
          updates++;
          batchSize++;
        }
      } else {
        const newRef = doc(collection(db, 'projects'));
        batch.set(newRef, { ...updatedData, createdAt: new Date().toISOString() });
        adds++;
        batchSize++;
        cleanMap.set(key, true); // Mark handled
      }

      if (batchSize >= 400) {
        await batch.commit();
        batch = writeBatch(db);
        batchSize = 0;
      }
    }

    if (batchSize > 0) await batch.commit();

    console.log(`Phase 2 Complete. ${updates} records updated, ${adds} new records added.`);
    process.exit(0);
  } catch (err) {
    console.error('Failure:', err);
    process.exit(1);
  }
}

repairDatabase();
