const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, doc, deleteDoc, setDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');
const fs = require('fs');
const path = require('path');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"' && nextChar === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseAccountingValue(str) {
  if (!str || str === '') return 0;
  // Remove dollar signs, commas, and spaces
  str = str.replace(/[$,\s]/g, '');
  if (str.startsWith('(') && str.endsWith(')')) {
    return -parseFloat(str.slice(1, -1)) || 0;
  }
  return parseFloat(str) || 0;
}

async function restoreGiantFromCSV() {
  try {
    console.log('\n=== Restoring Giant Projects from CSV ===\n');
    
    // Step 1: Delete the consolidated document
    console.log('Step 1: Deleting consolidated Giant document...');
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2508 - GI')
    );
    const snapshot = await getDocs(q);
    
    for (const docSnapshot of snapshot.docs) {
      await deleteDoc(doc(db, 'projects', docSnapshot.id));
      console.log(`  ✓ Deleted document: ${docSnapshot.id}`);
    }
    
    // Step 2: Read CSV and find Giant projects
    console.log('\nStep 2: Reading CSV file...');
    const csvPath = path.join(__dirname, '../src/app/Bid_Distro-Preconstruction (2).csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n');
    const headers = parseCSVLine(lines[0]);
    
    console.log(`  Found ${lines.length - 1} total records in CSV`);
    
    // Find all Giant-related projects (search for "2508" OR "Giant" in project number or name)
    const giantRecords = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = parseCSVLine(lines[i]);
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] || '';
      });
      
      const projectNum = record['projectNumber'] || '';
      const projectName = record['projectName'] || '';
      
      // Match "2508" at start of project number AND ("Giant" OR "6582") in project name
      if (projectNum.trim().startsWith('2508') && 
          (projectName.toLowerCase().includes('giant') || projectName.includes('6582'))) {
        giantRecords.push(record);
      }
    }
    
    console.log(`  Found ${giantRecords.length} Giant project records in CSV`);
    
    // Step 3: Import all Giant records
    console.log('\nStep 3: Importing Giant records to Firestore...');
    let imported = 0;
    
    for (const record of giantRecords) {
      const projectData = {
        projectNumber: record['projectNumber'],
        projectName: record['projectName'],
        customer: record['customer'],
        status: record['status'],
        projectStage: record['ProjectStage'],
        estimator: record['estimator'],
        pmcGroup: record['PMCGroup'] || '',
        costitems: record['Costitems'],
        costType: record['CostType'],
        quantity: parseFloat(record['Quantity']) || 0,
        sales: parseAccountingValue(record['sales']),
        cost: parseAccountingValue(record['cost']),
        hours: parseAccountingValue(record['hours']),
        laborSales: parseAccountingValue(record['LaborSales']),
        laborCost: parseAccountingValue(record['LaborCost']),
        dateCreated: record['dateCreated'],
        dateUpdated: record['dateUpdated'],
        projectArchived: record['ProjectArchived'] === 'Yes',
      };
      
      const docRef = doc(collection(db, 'projects'));
      await setDoc(docRef, projectData);
      imported++;
      
      if (imported % 100 === 0) {
        console.log(`  Imported ${imported}/${giantRecords.length}...`);
      }
    }
    
    console.log(`\n✓ Successfully restored ${imported} Giant project records from CSV`);
    console.log('\nNote: These are individual line item documents.');
    console.log('The dashboard will aggregate them correctly, but line item view will show all entries.');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

restoreGiantFromCSV();
