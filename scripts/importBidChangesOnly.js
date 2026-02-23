const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, writeBatch } = require('firebase/firestore');
const csv = require('csv-parse/sync');

// Firebase config (prefer env vars, fallback to firebaseConfig.json)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingConfigKeys.length > 0) {
  const configPath = path.join(__dirname, '../src/firebaseConfig.json');
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  firebaseConfig.apiKey = fileConfig.apiKey;
  firebaseConfig.authDomain = fileConfig.authDomain;
  firebaseConfig.projectId = fileConfig.projectId;
  firebaseConfig.storageBucket = fileConfig.storageBucket;
  firebaseConfig.messagingSenderId = fileConfig.messagingSenderId;
  firebaseConfig.appId = fileConfig.appId;
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Normalize header names to lowercase and underscores
const normalizeKey = (key) => {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
};

// Parse and convert values
const parseValue = (value, type) => {
  if (value === null || value === undefined || value === '') return null;

  if (type === 'number') {
    const str = value.toString().trim();
    if (!str) return null;
    const num = parseFloat(str.replace(/[$,]/g, ''));
    return Number.isFinite(num) ? num : null;
  }

  if (type === 'boolean') {
    const str = value.toString().trim().toLowerCase();
    if (!str) return null;
    return str === 'yes' || str === 'true' || str === '1';
  }

  if (type === 'date') {
    const str = value.toString().trim();
    return str || null;
  }

  if (type === 'string') {
    return value.toString().trim() || null;
  }

  return value;
};

const sanitizeDoc = (doc) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value === undefined) {
      sanitized[key] = null;
      continue;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      sanitized[key] = null;
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = null;
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
};

const buildDocFromRecord = (record) => {
  // Normalize keys from the CSV
  const normalized = {};
  for (const [key, value] of Object.entries(record)) {
    normalized[normalizeKey(key)] = value;
  }

  // Build document with all fields
  return {
    projectNumber: parseValue(normalized.projectnumber, 'string'),
    dateUpdated: parseValue(normalized.dateupdated, 'date'),
    reasonForLoss: parseValue(normalized.reasonforloss, 'string'),
    projectStage: parseValue(normalized.projectstage, 'string'),
    costitems: parseValue(normalized.costitems, 'string'),
    costType: parseValue(normalized.costtype, 'string'),
    quantity: parseValue(normalized.quantity, 'number'),
    sales: parseValue(normalized.sales, 'number'),
    laborSales: parseValue(normalized.laborsales, 'number'),
    laborCost: parseValue(normalized.laborcost, 'number'),
    cost: parseValue(normalized.cost, 'number'),
    hours: parseValue(normalized.hours, 'number'),
    projectArchived: parseValue(normalized.projectarchived, 'boolean'),
    customer: parseValue(normalized.customer, 'string'),
    projectName: parseValue(normalized.projectname, 'string'),
    status: parseValue(normalized.status, 'string'),
    testProject: parseValue(normalized.testproject, 'boolean'),
    active: parseValue(normalized.active, 'boolean'),
    dateCreated: parseValue(normalized.datecreated, 'date'),
    estimator: parseValue(normalized.estimator, 'string'),
    scopeOfWork: parseValue(normalized.scopeofwork, 'string'),
  };
};

const makeLineItemKey = (doc) => {
  const parts = [
    doc.projectNumber,
    doc.projectName,
    doc.customer,
    doc.costitems,
    doc.costType,
    doc.quantity,
  ];
  return parts
    .map((value) => (value ?? '').toString().trim().toLowerCase())
    .join('||');
};

// Compare two documents to check if they are different
const documentsAreDifferent = (doc1, doc2) => {
  const keys = new Set([...Object.keys(doc1), ...Object.keys(doc2)]);
  for (const key of keys) {
    const left = doc1[key] === undefined ? null : doc1[key];
    const right = doc2[key] === undefined ? null : doc2[key];
    if (left !== right) {
      return true;
    }
  }
  return false;
};

async function importBidChangesOnly() {
  try {
    console.log('Reading CSV file...');
    const csvArg = process.argv.find((arg) => arg.toLowerCase().endsWith('.csv'));
    const csvPath = csvArg
      ? path.resolve(csvArg)
      : path.join(__dirname, '../src/Bid_Distro-Preconstruction (2).csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');

    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Parsed ${records.length} records from CSV\n`);

    const deleteMissing = !process.argv.includes('--no-delete');

    // Fetch all existing projects from Firestore
    console.log('Fetching existing projects from Firestore...');
    const snapshot = await getDocs(collection(db, 'projects'));
    const existingProjects = new Map();
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const key = makeLineItemKey(data);
      if (!existingProjects.has(key)) {
        existingProjects.set(key, []);
      }
      existingProjects.get(key).push({
        id: docSnap.id,
        data: data,
      });
    }
    
    console.log(`Found ${snapshot.docs.length} existing line items\n`);

    // Compare and process records
    let newCount = 0;
    let updateCount = 0;
    let skippedCount = 0;
    let deleteCount = 0;
    const results = {
      new: [],
      updated: [],
      skipped: [],
      deleted: [],
      errors: [],
    };

    const BATCH_SIZE = 450;
    let batch = writeBatch(db);
    let batchOps = 0;

    const commitBatch = async () => {
      if (batchOps === 0) return;
      await batch.commit();
      batch = writeBatch(db);
      batchOps = 0;
    };

    const queueSet = async (docRef, data) => {
      batch.set(docRef, data);
      batchOps += 1;
      if (batchOps >= BATCH_SIZE) {
        await commitBatch();
      }
    };

    const queueDelete = async (docRef) => {
      batch.delete(docRef);
      batchOps += 1;
      if (batchOps >= BATCH_SIZE) {
        await commitBatch();
      }
    };

    for (let i = 0; i < records.length; i++) {
      try {
        const record = records[i];
        const newDoc = sanitizeDoc(buildDocFromRecord(record));
        const projectNumber = newDoc.projectNumber;
        const lineItemKey = makeLineItemKey(newDoc);
        newDoc.lineItemKey = lineItemKey;

        // Import all rows, even those without project numbers
        // If projectNumber is empty, it will be stored as null

        const existingList = existingProjects.get(lineItemKey);

        if (existingList && existingList.length > 0) {
          const existing = existingList.shift();
          const existingDoc = existing.data;

          if (documentsAreDifferent(newDoc, existingDoc)) {
            const docRef = doc(db, 'projects', existing.id);
            await queueSet(docRef, newDoc);
            updateCount++;
            results.updated.push({
              projectNumber,
              firebaseId: existing.id,
            });
          } else {
            skippedCount++;
            results.skipped.push({
              projectNumber,
              reason: 'No changes detected',
            });
          }
        } else {
          const docRef = doc(collection(db, 'projects'));
          await queueSet(docRef, newDoc);
          newCount++;
          results.new.push({
            projectNumber,
            firebaseId: docRef.id,
          });
        }

        if ((newCount + updateCount + skippedCount) % 50 === 0) {
          console.log(`Progress: ${newCount + updateCount + skippedCount} records processed`);
        }
      } catch (error) {
        results.errors.push({
          row: i + 2,
          error: error.message,
        });
        if (results.errors.length <= 5) {
          console.error(`❌ Error processing record ${i}:`, error.message);
        }
      }
    }

    if (deleteMissing) {
      console.log('\nRemoving records not present in the CSV...');
      for (const [, list] of existingProjects.entries()) {
        if (!list || list.length === 0) continue;
        for (const item of list) {
          const docRef = doc(db, 'projects', item.id);
          await queueDelete(docRef);
          deleteCount++;
          results.deleted.push({
            firebaseId: item.id,
            projectNumber: item.data.projectNumber || null,
          });
        }
      }
    }

    await commitBatch();

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ New projects added: ${newCount}`);
    console.log(`✏️  Existing projects updated: ${updateCount}`);
    console.log(`⏭️  Projects skipped (no changes): ${skippedCount}`);
    console.log(`🗑️  Projects deleted (not in CSV): ${deleteCount}`);
    console.log(`❌ Errors: ${results.errors.length}`);
    console.log('='.repeat(60));

    // Save detailed results to a file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = path.join(__dirname, `../bid-import-results-${timestamp}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`\n📄 Detailed results saved to: bid-import-results-${timestamp}.json`);

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

importBidChangesOnly();
