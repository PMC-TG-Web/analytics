/**
 * testInitKemper.js
 * 
 * Test initialization for Kemper Equipment only
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

async function testInitKemper() {
  console.log('\n🧪 Testing initialization for Kemper Equipment\n');
  console.log('JobKey:', KEMPER_JOB_KEY);
  console.log('');
  
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
  console.log('');
  
  // STEP 2: Get schedule allocation
  console.log('📅 Step 2: Reading schedule...');
  const schedulesSnapshot = await getDocs(
    query(collection(db, 'schedules'), where('jobKey', '==', KEMPER_JOB_KEY))
  );
  
  let firstMonthDate = null;
  if (!schedulesSnapshot.empty) {
    const schedule = schedulesSnapshot.docs[0].data();
    console.log('   Total hours in schedule:', schedule.totalHours);
    
    if (schedule.allocations) {
      const sortedMonths = Object.entries(schedule.allocations)
        .filter(([month, pct]) => pct > 0)
        .sort(([a], [b]) => a.localeCompare(b));
      
      console.log('   Allocations:');
      sortedMonths.forEach(([month, pct]) => {
        console.log(`     ${month}: ${pct}%`);
      });
      
      if (sortedMonths.length > 0) {
        const [firstMonth] = sortedMonths[0];
        const [year, month] = firstMonth.split('-').map(Number);
        firstMonthDate = getFirstMondayOfMonth(year, month);
        console.log(`   First Monday of ${firstMonth}: ${firstMonthDate}`);
      }
    }
  }
  console.log('');
  
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
      
      console.log(`   - ${scope.title}:`);
      console.log(`       Start: ${scope.startDate || 'None'}`);
      console.log(`       End: ${scope.endDate || 'None'}`);
      console.log(`       Manpower: ${scope.manpower || 0}`);
      console.log(`       Stored Hours: ${scope.hours || 0}`);
    }
  });
  console.log('');
  
  // STEP 4: Show what would be created in activeSchedule
  console.log('✍️  Step 4: activeSchedule entries to create:\n');
  
  const activeScheduleEntries = [];
  
  for (const [scopeOfWork, totalHours] of Object.entries(scopeTotals)) {
    if (totalHours === 0) continue;
    
    const datedScope = datedScopes[scopeOfWork];
    
    if (datedScope && datedScope.startDate) {
      // Use dated scope
      const startDate = datedScope.startDate;
      const endDate = datedScope.endDate || startDate;
      const manpower = datedScope.manpower;
      const workDays = calculateWorkDays(startDate, endDate);
      
      const hoursToSchedule = (manpower > 0 && workDays > 0) 
        ? manpower * 10 * workDays 
        : totalHours;
      
      activeScheduleEntries.push({
        scopeOfWork,
        date: startDate,
        hours: hoursToSchedule,
        manpower: manpower || 0,
        source: 'gantt',
        totalHours: totalHours
      });
      
      console.log(`   📍 ${scopeOfWork}`);
      console.log(`      Date: ${startDate} (from projectScopes)`);
      console.log(`      Hours: ${hoursToSchedule} (calculated from manpower: ${manpower} × 10 × ${workDays})`);
      console.log(`      Total project hours: ${totalHours}`);
      console.log(`      Source: gantt`);
      console.log('');
    } else {
      // Use first Monday
      activeScheduleEntries.push({
        scopeOfWork,
        date: firstMonthDate,
        hours: totalHours,
        source: 'schedules',
        totalHours: totalHours
      });
      
      console.log(`   📍 ${scopeOfWork}`);
      console.log(`      Date: ${firstMonthDate} (first Monday, no dates in projectScopes)`);
      console.log(`      Hours: ${totalHours}`);
      console.log(`      Source: schedules`);
      console.log('');
    }
  }
  
  // STEP 5: Show scopeTracking
  console.log('📈 Step 5: scopeTracking entries to create:\n');
  
  const scheduledByScope = {};
  activeScheduleEntries.forEach(entry => {
    if (!scheduledByScope[entry.scopeOfWork]) {
      scheduledByScope[entry.scopeOfWork] = 0;
    }
    scheduledByScope[entry.scopeOfWork] += entry.hours;
  });
  
  for (const [scopeOfWork, totalHours] of Object.entries(scopeTotals)) {
    const scheduledHours = scheduledByScope[scopeOfWork] || 0;
    console.log(`   📊 ${scopeOfWork}`);
    console.log(`      Total Hours: ${totalHours}`);
    console.log(`      Scheduled Hours: ${scheduledHours}`);
    console.log(`      Unscheduled Hours: ${totalHours - scheduledHours}`);
    console.log('');
  }
  
  // Ask for confirmation
  console.log('─'.repeat(70));
  console.log('\n❓ This is a DRY RUN. The above shows what would be created.');
  console.log('   No data has been written to Firestore yet.\n');
}

testInitKemper()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
