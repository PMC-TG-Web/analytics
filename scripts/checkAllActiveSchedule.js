const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

// Load firebase config
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkAllActiveSchedule() {
  console.log('\n🔍 Checking ALL activeSchedule documents\n');

  // Get ALL documents
  const allSnapshot = await getDocs(collection(db, 'activeSchedule'));
  console.log(`📊 Total documents in activeSchedule: ${allSnapshot.size}\n`);

  if (allSnapshot.size === 0) {
    console.log('❌ NO DOCUMENTS FOUND!\n');
    return;
  }

  // Group by jobKey
  const byJobKey = {};
  allSnapshot.docs.forEach(doc => {
    const data = doc.data();
    const jobKey = data.jobKey || 'UNKNOWN';
    if (!byJobKey[jobKey]) {
      byJobKey[jobKey] = [];
    }
    byJobKey[jobKey].push({ id: doc.id, ...data });
  });

  // Display
  Object.entries(byJobKey).forEach(([jobKey, entries]) => {
    const customer = jobKey.split('~')[0] || 'Unknown';
    const project = jobKey.split('~').pop() || jobKey;
    console.log(`📁 ${customer} - ${project}`);
    console.log(`   ${entries.length} entries`);
    
    entries.forEach(entry => {
      console.log(`   └─ ${entry.date}: ${entry.hours} hrs (${entry.scopeOfWork})`);
    });
    console.log('');
  });

  // Check specifically for Kemper
  console.log('\n🎯 Searching specifically for Kemper...\n');
  const kemperQuery = query(
    collection(db, 'activeSchedule'),
    where('jobKey', '==', 'Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment')
  );
  const kemperSnapshot = await getDocs(kemperQuery);
  console.log(`Found ${kemperSnapshot.size} Kemper documents with query`);
  
  kemperSnapshot.docs.forEach(doc => {
    console.log(`   Doc ID: ${doc.id}`);
    console.log(`   Data:`, doc.data());
  });
}

checkAllActiveSchedule()
  .then(() => {
    console.log('\n✅ Done\n');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
