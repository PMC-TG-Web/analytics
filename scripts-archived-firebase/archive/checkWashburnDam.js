const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig).filter(([, value]) => !value).map(([key]) => key);
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

initializeApp(firebaseConfig);
const db = getFirestore();

function getProjectKey(p) {
  const customer = (p.customer || "").trim().replace(/\s+/g, " ");
  const projectNumber = (p.projectNumber || "").trim().replace(/\s+/g, " ");
  const projectName = (p.projectName || "").trim().replace(/\s+/g, " ");
  return `${customer}|${projectNumber}|${projectName}`.toLowerCase();
}

async function checkWashburnDam() {
  try {
    const projectsSnapshot = await getDocs(query(
      collection(db, "projects"),
      where("projectName", "==", "Washburn Dam"),
      where("projectArchived", "==", false)
    ));
    
    const projects = projectsSnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));

    console.log(`\n=== Washburn Dam Project Analysis ===`);
    console.log(`Found ${projects.length} project documents\n`);

    console.log(`=== Projects with Hours > 0 ===`);
    const projectsWithHours = projects.filter(p => p.hours && p.hours > 0);
    
    projectsWithHours.forEach(p => {
      const scopeName = (p.scopeOfWork || 'Default Scope').trim();
      const pmcGroup = (p.pmcGroup || 'No PMC Group').toString();
      const costType = (p.costType || '').toString().toLowerCase();
      const costitems = (p.costitems || '').toString();
      const hours = p.hours || 0;
      
      console.log(`\n📄 Project Doc:`);
      console.log(`   scopeOfWork: "${scopeName}"`);
      console.log(`   pmcGroup: "${pmcGroup}"`);
      console.log(`   costitems: "${costitems}"`);
      console.log(`   hours: ${hours}`);
    });

    console.log(`\n\n=== Summary by Scope ===`);
    // Group by scopeOfWork
    const scopesByName = {};
    
    projects.forEach(p => {
      const scopeName = (p.scopeOfWork || 'Default Scope').trim();
      const pmcGroup = (p.pmcGroup || 'No PMC Group').toString();
      const costType = (p.costType || '').toString().toLowerCase();
      const costitems = (p.costitems || '').toString();
      const hours = p.hours || 0;
      
      console.log(`\n📄 Project Doc:`);
      console.log(`   scopeOfWork: "${scopeName}"`);
      console.log(`   pmcGroup: "${pmcGroup}"`);
      console.log(`   costitems: "${costitems}"`);
      console.log(`   hours: ${hours}`);
      
      if (!scopesByName[scopeName]) {
        scopesByName[scopeName] = {
          totalHours: 0,
          items: []
        };
      }
      
      scopesByName[scopeName].totalHours += hours;
      scopesByName[scopeName].items.push({
        pmcGroup,
        costType,
        costitems: p.costitems || '',
        hours,
        sales: p.sales || 0,
        cost: p.cost || 0
      });
    });

    // Display results
    console.log(`\n=== Scopes Grouped by scopeOfWork ===\n`);
    Object.entries(scopesByName).forEach(([scopeName, data]) => {
      console.log(`\n📋 SCOPE: ${scopeName}`);
      console.log(`   Total Hours: ${data.totalHours}`);
      console.log(`   Breakdown:`);
      
      data.items.forEach(item => {
        const isManagement = item.costType.includes('management') || item.pmcGroup.toLowerCase().includes('management');
        const label = isManagement ? '⚠️  EXCLUDED' : '✓';
        const costItemsStr = item.costitems ? ` | ${item.costitems}` : '';
        console.log(`   ${label} ${item.pmcGroup.padEnd(30)} | ${item.hours} hrs | $${item.sales.toLocaleString()}${costItemsStr}`);
      });
      
      const nonMgmtHours = data.items
        .filter(i => !i.costType.includes('management') && !i.pmcGroup.toLowerCase().includes('management'))
        .reduce((sum, i) => sum + i.hours, 0);
      
      console.log(`   ➡️  TOTAL (excluding management): ${nonMgmtHours} hrs`);
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

checkWashburnDam();
