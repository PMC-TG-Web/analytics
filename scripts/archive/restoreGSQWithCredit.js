const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');
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

async function restoreGSQWithCredit() {
  try {
    // Read CSV file
    const csvPath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (1).csv';
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = csv.parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      ltrim: true,
      rtrim: true,
    });

    // Filter GSQ records from CSV
    const gsqRecords = records.filter(r => {
      const pn = r.projectNumber ? r.projectNumber.trim() : '';
      return pn === '2601 - GSQ';
    });

    console.log(`Found ${gsqRecords.length} GSQ records in CSV`);

    if (gsqRecords.length === 0) {
      console.log('No GSQ records found in CSV');
      process.exit(1);
    }

    // Convert records to items
    const items = gsqRecords.map(record => {
      // Parse sales and cost values, handling accounting format (parentheses = negative)
      const parseSalesValue = (val) => {
        if (!val) return 0;
        const str = val.toString().trim();
        if (str.startsWith('(') && str.endsWith(')')) {
          // Accounting format: (value) = negative
          return -parseFloat(str.slice(1, -1).replace(/[^0-9.-]/g, '')) || 0;
        }
        return parseFloat(str.replace(/[^0-9.-]/g, '')) || 0;
      };

      return {
        dateUpdated: record.dateUpdated || '',
        ReasonForLoss: record.ReasonForLoss || '',
        ProjectStage: record.ProjectStage || '',
        Costitems: record.Costitems || '',
        CostType: record.CostType || '',
        Quantity: isNaN(parseFloat(record.Quantity)) ? 0 : parseFloat(record.Quantity),
        sales: parseSalesValue(record.sales),
        LaborSales: parseSalesValue(record.LaborSales),
        LaborCost: parseSalesValue(record.LaborCost),
        cost: parseSalesValue(record.cost),
        hours: isNaN(parseFloat(record.hours)) ? 0 : parseFloat(record.hours),
        ProjectArchived: record.ProjectArchived || '',
        customer: record.customer || '',
        projectName: record.projectName || '',
        status: record.status || '',
        TestProject: record.TestProject || '',
        Active: record.Active || '',
        dateCreated: record.dateCreated || '',
        estimator: record.estimator || '',
      };
    });

    console.log(`Converted to ${items.length} items`);

    // Find the GSQ project in database
    const projectsRef = collection(db, 'projects');
    const snapshot = await getDocs(projectsRef);

    let gsqDoc = null;
    for (const doc of snapshot.docs) {
      if (doc.data().projectNumber === '2601 - GSQ') {
        gsqDoc = doc;
        break;
      }
    }

    if (!gsqDoc) {
      console.log('No Goods Store Quarryville project found in database');
      process.exit(1);
    }

    console.log(`Found GSQ project in database`);

    // Update the document with all items
    const docRef = doc(db, 'projects', gsqDoc.id);
    await updateDoc(docRef, {
      items: items
    });

    console.log(`✓ Restored ${items.length} items to GSQ project`);

    // Calculate totals
    const totalSales = items.reduce((sum, item) => sum + (item.sales || 0), 0);
    const totalCost = items.reduce((sum, item) => sum + (item.cost || 0), 0);
    const totalHours = items.reduce((sum, item) => sum + (item.hours || 0), 0);

    console.log(`  Total sales: $${totalSales.toFixed(2)}`);
    console.log(`  Total cost: $${totalCost.toFixed(2)}`);
    console.log(`  Total hours: ${totalHours}`);

  } catch (error) {
    console.error('Error restoring GSQ data:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

restoreGSQWithCredit();
