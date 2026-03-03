/**
 * initKemperOnly.js
 * 
 * Initialize activeSchedule and scopeTracking for Kemper Equipment only
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, Timestamp, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const KEMPER_JOB_KEY = "Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment";

function getFirstMondayOfMonth(year, month) {
  const date = new Date(year, month - 1, 1);
  const day = date.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  date.setDate(date.getDate() + daysUntilMonday);
  return date.toISOString().split('T')[0];
}

function sanitize(str) {
  return str.replace(/[\/\\#?]/g, '_');
}

function getActiveScheduleDocId(jobKey, scopeOfWork, date) {
  return `${sanitize(jobKey)}_${sanitize(scopeOfWork)}_${date}`;
}

function getScopeTrackingDocId(jobKey, scopeOfWork) {
  return `${sanitize(jobKey)}_${sanitize(scopeOfWork)}`;
}

function calculateWorkDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  const current = new Date(start);
  
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

async function initKemperOnly() {
  console.log('\n🚀 Initializing activeSchedule for Kemper Equipment\n');
  
  // STEP 1: Get Kemper projects and aggregate scope hours
  console.log('📊 Step 1: Reading Kemper projects...');
  const projectsSnapshot = await getDocs(
    query(collection(db, 'projects'),
      where('customer', '==', 'Hoover Building Specialists, Inc.'),
      where('projectNumber', '==', '2505 - KE'))
  );
  
  const scopeTotals = {};
  projectsSnapshot.docs.forEach(doc => {
    const project = doc.data();
    const scopeOfWork = (project.scopeOfWork || 'Default Scope').trim();
    const hours = project.hours || 0;
    
    if (!scopeTotals[scopeOfWork]) {
      scopeTotals[scopeOfWork] = 0;
    }
    scopeTotals[scopeOfWork] += hours;
  });
  
  console.log('   Scope totals:');
  Object.entries(scopeTotals).forEach(([scope, hours]) => {
    console.log(`     - ${scope}: ${hours} hrs`);
  });
  const totalHours = Object.values(scopeTotals).reduce((sum, h) => sum + h, 0);
  console.log(`   Total: ${totalHours} hrs\n`);
  
  // STEP 2: Get schedule allocation
  console.log('📅 Step 2: Reading schedule...');
  const schedulesSnapshot = await getDocs(
    query(collection(db, 'schedules'), where('jobKey', '==', KEMPER_JOB_KEY))
  );
  
  let firstMonthDate = '2026-02-02'; // Default
  if (!schedulesSnapshot.empty) {
    const schedule = schedulesSnapshot.docs[0].data();
    
    if (schedule.allocations) {
      const sortedMonths = Object.entries(schedule.allocations)
        .filter(([month, pct]) => pct > 0)
        .sort(([a], [b]) => a.localeCompare(b));
      
      if (sortedMonths.length > 0) {
        const [firstMonth] = sortedMonths[0];
        const [year, month] = firstMonth.split('-').map(Number);
        firstMonthDate = getFirstMondayOfMonth(year, month);
        console.log(`   First Monday of ${firstMonth}: ${firstMonthDate}\n`);
      }
    }
  }
  
  // STEP 3: Get dated scopes from projectScopes
  console.log('🎯 Step 3: Reading projectScopes...');
  const projectScopesSnapshot = await getDocs(
    query(collection(db, 'projectScopes'), where('jobKey', '==', KEMPER_JOB_KEY))
  );
  
  const datedScopes = {};
  projectScopesSnapshot.docs.forEach(doc => {
    const scope = doc.data();
    if (scope.title) {
      datedScopes[scope.title.trim()] = {
        startDate: scope.startDate,
        endDate: scope.endDate,
        manpower: scope.manpower || 0,
        hours: scope.hours || 0
      };
    }
  });
  console.log(`   Found ${Object.keys(datedScopes).length} scopes in projectScopes\n`);
  
  // STEP 4: Create activeSchedule entries
  console.log('✍️  Step 4: Creating activeSchedule entries...\n');
  
  const activeScheduleEntries = [];
  
  for (const [scopeOfWork, totalHours] of Object.entries(scopeTotals)) {
    if (totalHours === 0) continue;
    
    const datedScope = datedScopes[scopeOfWork];
    let entry;
    
    if (datedScope && datedScope.startDate) {
      // Use dated scope
      const startDate = datedScope.startDate;
      const endDate = datedScope.endDate || startDate;
      const manpower = datedScope.manpower;
      const workDays = calculateWorkDays(startDate, endDate);
      
      const hoursToSchedule = (manpower > 0 && workDays > 0) 
        ? manpower * 10 * workDays 
        : totalHours;
      
      entry = {
        jobKey: KEMPER_JOB_KEY,
        scopeOfWork,
        date: startDate,
        hours: hoursToSchedule,
        manpower: manpower || 0,
        source: 'gantt',
        lastModified: Timestamp.now()
      };
      
      console.log(`   ✓ ${scopeOfWork}: ${hoursToSchedule} hrs on ${startDate} (gantt)`);
    } else {
      // Use first Monday
      entry = {
        jobKey: KEMPER_JOB_KEY,
        scopeOfWork,
        date: firstMonthDate,
        hours: totalHours,
        source: 'schedules',
        lastModified: Timestamp.now()
      };
      
      console.log(`   ✓ ${scopeOfWork}: ${totalHours} hrs on ${firstMonthDate} (schedules)`);
    }
    
    // Write to Firestore
    const docId = getActiveScheduleDocId(KEMPER_JOB_KEY, scopeOfWork, entry.date);
    await setDoc(doc(db, 'activeSchedule', docId), entry);
    
    activeScheduleEntries.push(entry);
  }
  
  console.log(`\n✅ Created ${activeScheduleEntries.length} activeSchedule entries\n`);
  
  // STEP 5: Create scopeTracking entries
  console.log('📈 Step 5: Creating scopeTracking entries...\n');
  
  const scheduledByScope = {};
  activeScheduleEntries.forEach(entry => {
    if (!scheduledByScope[entry.scopeOfWork]) {
      scheduledByScope[entry.scopeOfWork] = 0;
    }
    scheduledByScope[entry.scopeOfWork] += entry.hours;
  });
  
  for (const [scopeOfWork, totalHours] of Object.entries(scopeTotals)) {
    const scheduledHours = scheduledByScope[scopeOfWork] || 0;
    const docId = getScopeTrackingDocId(KEMPER_JOB_KEY, scopeOfWork);
    
    await setDoc(doc(db, 'scopeTracking', docId), {
      jobKey: KEMPER_JOB_KEY,
      scopeOfWork,
      totalHours,
      scheduledHours,
      unscheduledHours: totalHours - scheduledHours,
      lastUpdated: Timestamp.now()
    });
    
    console.log(`   ✓ ${scopeOfWork}`);
    console.log(`      Total: ${totalHours}, Scheduled: ${scheduledHours}, Unscheduled: ${totalHours - scheduledHours}`);
  }
  
  console.log(`\n🎉 Initialization complete!\n`);
}

initKemperOnly()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
