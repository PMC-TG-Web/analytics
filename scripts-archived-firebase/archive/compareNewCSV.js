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

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingConfigKeys.length > 0) {
  const configPath = path.join(__dirname, '../src/firebaseConfig.json');
  if (fs.existsSync(configPath)) {
    const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    firebaseConfig.apiKey = fileConfig.apiKey;
    firebaseConfig.authDomain = fileConfig.authDomain;
    firebaseConfig.projectId = fileConfig.projectId;
    firebaseConfig.storageBucket = fileConfig.storageBucket;
    firebaseConfig.messagingSenderId = fileConfig.messagingSenderId;
    firebaseConfig.appId = fileConfig.appId;
  }
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function compareNewCSV() {
  try {
    const filePath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (5).csv';
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    // Using a more flexible parser to handle the Procore headers
    const csvRecords = csv.parse(fileContent, { columns: true, skip_empty_lines: true, trim: true });

    console.log(`\n=== CSV ANALYSIS (New Export) ===`);
    console.log(`Total CSV records: ${csvRecords.length}`);

    const csvMap = new Map();
    let csvTotalSales = 0;
    
    csvRecords.forEach(record => {
      // Procore Export Header Mappings
      const projectNumber = (record['Project > Number'] || '').trim();
      const projectName = (record['Estimating Project > Estimate Project Name'] || '').trim();
      const customer = (record['Estimating Project > Customer Company'] || '').trim();
      const status = (record['Estimating Project > Status'] || '').trim();
      const costItem = (record['Estimate Layer > Cost Item'] || '').trim();
      const scope = (record['Estimate Layer Group > Cost Item'] || '').trim();
      
      const salesRaw = (record['Estimate Layer > Total Sales'] || '0').replace(/[$,]/g, '').trim();
      const sales = parseFloat(salesRaw) || 0;
      
      csvTotalSales += sales;
      
      // Creating a key that matches how records are typically stored in the database
      // If the DB doesn't have costItem, we might need to adjust this.
      // Based on previous script, it uses: projectNumber||customer||costItems
      const key = `${projectNumber}||${customer}||${costItem}`.toLowerCase();
      
      if (!csvMap.has(key)) {
        csvMap.set(key, {
            projectNumber,
            projectName,
            customer,
            status,
            costItem,
            sales,
            recordCount: 1
        });
      } else {
        const existing = csvMap.get(key);
        existing.sales += sales;
        existing.recordCount += 1;
      }
    });

    console.log(`Unique Keys in CSV: ${csvMap.size}`);
    console.log(`Total CSV sales: $${csvTotalSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

    // Fetch from Firebase
    console.log(`\nFetching projects from Firestore...`);
    const snapshot = await getDocs(collection(db, 'projects'));
    const dbRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    console.log(`=== DATABASE ANALYSIS ===`);
    console.log(`Total DB records (raw): ${dbRecords.length}`);

    const dbMap = new Map();
    let dbTotalSales = 0;
    
    dbRecords.forEach(record => {
      const projectNumber = (record.projectNumber || '').trim();
      const customer = (record.customer || '').trim();
      const costItem = (record.costitems || '').trim(); // DB uses costitems
      const sales = parseFloat(record.sales) || 0;
      
      dbTotalSales += sales;
      const key = `${projectNumber}||${customer}||${costItem}`.toLowerCase();
      
      if (!dbMap.has(key)) {
        dbMap.set(key, { sales, count: 1 });
      } else {
        const existing = dbMap.get(key);
        existing.sales += sales;
        existing.count += 1;
      }
    });

    console.log(`Unique Keys in DB: ${dbMap.size}`);
    console.log(`Total DB sales: $${dbTotalSales.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

    // Compare
    console.log(`\n=== COMPARISON RESULTS ===`);
    let missingFromDb = 0;
    let missingSales = 0;
    let mismatchCount = 0;
    let mismatchSalesDiff = 0;

    csvMap.forEach((csvData, key) => {
        const dbData = dbMap.get(key);
        if (!dbData) {
            missingFromDb++;
            missingSales += csvData.sales;
            if (missingFromDb <= 10) {
                console.log(`[MISSING] ${csvData.projectName} (${csvData.customer}): $${csvData.sales.toLocaleString()}`);
            }
        } else {
            const diff = Math.abs(csvData.sales - dbData.sales);
            if (diff > 0.01) {
                mismatchCount++;
                mismatchSalesDiff += (csvData.sales - dbData.sales);
                if (mismatchCount <= 10) {
                    console.log(`[MISMATCH] ${csvData.projectName}: CSV=$${csvData.sales.toLocaleString()}, DB=$${dbData.sales.toLocaleString()} (Diff=$${(csvData.sales - dbData.sales).toLocaleString()})`);
                }
            }
        }
    });

    console.log(`\nSummary:`);
    console.log(`- Missing Projects/Items in DB: ${missingFromDb} ($${missingSales.toLocaleString()})`);
    console.log(`- Value Mismatches: ${mismatchCount} ($${mismatchSalesDiff.toLocaleString()} total difference)`);
    
    // Check for records in DB but not in CSV
    let extraInDb = 0;
    dbMap.forEach((_, key) => {
        if (!csvMap.has(key)) extraInDb++;
    });
    console.log(`- Extras in DB (not in new CSV): ${extraInDb}`);

    process.exit(0);
  } catch (error) {
    console.error('CRITICAL ERROR:', error);
    process.exit(1);
  }
}

compareNewCSV();
