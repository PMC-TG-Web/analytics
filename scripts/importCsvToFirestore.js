const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, deleteDoc, getDocs } = require('firebase/firestore');
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

async function importCsvToFirestore() {
  try {
    console.log('Reading CSV file...');
    const csvPath = path.join(__dirname, '../src/Bid_Distro-Preconstruction (3).csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');

    const records = csv.parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`Parsed ${records.length} records from CSV`);

    // Normalize header names to lowercase and underscores
    const normalizeKey = (key) => {
      return key.trim().toLowerCase()
        .replace(/\s*>\s*/g, '_')  // Replace " > " with "_"
        .replace(/\s+/g, '_')       // Replace spaces with "_"
        .replace(/[()]/g, '');      // Remove parentheses
    };

    // Parse and convert values
    const parseValue = (value, type) => {
      if (value === null || value === undefined || value === '') return null;

      if (type === 'number') {
        const str = value.toString().trim();
        if (!str) return null;
        // Handle both "$1,234.56" and "1234.56" formats
        const num = parseFloat(str.replace(/[$,\s]/g, ''));
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

    // Clear existing data
    console.log('Clearing existing projects...');
    const snapshot = await getDocs(collection(db, 'projects'));
    for (const doc of snapshot.docs) {
      await deleteDoc(doc.ref);
    }
    console.log('Cleared existing projects');

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

    // Upload records
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < records.length; i++) {
      try {
        const record = records[i];
        
        // Normalize keys from the CSV
        const normalized = {};
        for (const [key, value] of Object.entries(record)) {
          normalized[normalizeKey(key)] = value;
        }

        // Build document with all fields
        const doc = {
          projectNumber: parseValue(normalized.projectnumber, 'string'),
          dateUpdated: parseValue(normalized.dateupdated, 'date'),
          projectUpdateDate: parseValue(normalized.projectupdatedate, 'date'),
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
        };
        const sanitizedDoc = sanitizeDoc(doc);

        if (i === 0) {
          console.log('Sample sanitized record:', sanitizedDoc);
        }

        await addDoc(collection(db, 'projects'), sanitizedDoc);
        successCount++;

        if ((successCount + errorCount) % 100 === 0) {
          console.log(`Progress: ${successCount + errorCount} records processed (${successCount} success, ${errorCount} errors)`);
        }
      } catch (error) {
        errorCount++;
        if (errorCount <= 5) {
          console.error(`Error importing record ${i}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Successfully imported ${successCount} projects to Firestore`);
    console.log(`⚠️  Errors: ${errorCount}`);
    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

importCsvToFirestore();
