const fs = require('fs');
const csv = require('csv-parse/sync');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');

const config = JSON.parse(fs.readFileSync('src/firebaseConfig.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app);

async function compare() {
  const filePath = 'c:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (5).csv';
  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const records = csv.parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
  
  const targetProject = "Audubon Collegeville";
  const csvRows = records.filter(r => r['Estimating Project > Estimate Project Name'] === targetProject);
  
  console.log(`CSV has ${csvRows.length} rows for ${targetProject}`);

  const q = query(collection(db, 'projects'), where('projectName', '==', targetProject));
  const dbSnap = await getDocs(q);
  console.log(`DB has ${dbSnap.docs.length} rows for ${targetProject}`);

  const makeKey = (p, n, c, g, i) => `${p}|${n}|${c}|${g}|${i}`.toLowerCase().replace(/\s+/g, ' ').trim();

  const dbKeys = dbSnap.docs.map(d => {
    const data = d.data();
    return makeKey(
      data.projectName || '',
      data.projectNumber || '',
      data.customer || '',
      data.pmcGroup || data.scopeOfWork || '',
      data.costItem || data.costitems || ''
    );
  });

  csvRows.forEach(r => {
    const key = makeKey(
      r['Estimating Project > Estimate Project Name'] || '',
      r['Project > Number'] || '',
      r['Estimating Project > Customer Company'] || '',
      r['Estimate Layer Group > Cost Item'] || '',
      r['Estimate Layer > Cost Item'] || ''
    );
    const match = dbKeys.includes(key);
    console.log(`CSV Row: ${r['Estimate Layer Group > Cost Item']} | ${r['Estimate Layer > Cost Item']} -> Match: ${match}`);
    if (!match) {
      console.log(`  Generated Key: [${key}]`);
      console.log(`  Sample DB Key: [${dbKeys[0]}]`);
    }
  });
}

compare();
