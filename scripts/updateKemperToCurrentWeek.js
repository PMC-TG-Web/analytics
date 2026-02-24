/**
 * updateKemperToCurrentWeek.js
 * 
 * Move Kemper activeSchedule entries to current week for testing
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, Timestamp, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const KEMPER_JOB_KEY = "Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment";

function sanitize(str) {
  return str.replace(/[\/\\#?]/g, '_');
}

function getActiveScheduleDocId(jobKey, scopeOfWork, date) {
  return `${sanitize(jobKey)}_${sanitize(scopeOfWork)}_${date}`;
}

async function updateKemper() {
  console.log('\n🔄 Moving Kemper to current week (Feb 24, 2026)\n');
  
  // Get existing Kemper entries
  const q = query(collection(db, 'activeSchedule'), where('jobKey', '==', KEMPER_JOB_KEY));
  const snapshot = await getDocs(q);
  
  console.log(`Found ${snapshot.docs.length} existing entries\n`);
  
  // Delete old entries
  for (const docSnap of snapshot.docs) {
    await deleteDoc(doc(db, 'activeSchedule', docSnap.id));
    console.log(`   Deleted: ${docSnap.id}`);
  }
  
  // Create new entries on Feb 24 (today)
  const newDate = '2026-02-24';
  
  const scopes = [
    { name: '10,190 Sq Ft 6" Building Slab', hours: 252 },
    { name: '1,423 Sq Ft 8" Dock Apron', hours: 79 },
    { name: '4 each 6" x 7\' Bollards', hours: 6 }
  ];
  
  console.log(`\nCreating new entries on ${newDate}:\n`);
  
  for (const scope of scopes) {
    const docId = getActiveScheduleDocId(KEMPER_JOB_KEY, scope.name, newDate);
    
    await setDoc(doc(db, 'activeSchedule', docId), {
      jobKey: KEMPER_JOB_KEY,
      scopeOfWork: scope.name,
      date: newDate,
      hours: scope.hours,
      source: 'schedules',
      lastModified: Timestamp.now()
    });
    
    console.log(`   ✓ ${scope.name}: ${scope.hours} hrs`);
  }
  
  console.log(`\n✅ Updated Kemper to ${newDate}\n`);
}

updateKemper()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
